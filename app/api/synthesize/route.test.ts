import { describe, expect, it, vi, beforeEach } from "vitest";

// Two things are asserted here: the disciplinary framing of the prompt (pure
// function, no mocks needed) and the tenancy of the handler itself. The handler
// half needs the paid + persistent collaborators mocked, because the assertion is
// precisely that they are NEVER reached without a session.
vi.mock("@/src/lib/gemini", () => ({
  generate: vi.fn(),
  streamGenerate: vi.fn(),
  embedTexts: vi.fn(async () => []),
}));
vi.mock("@/src/lib/aiusage", () => ({
  logAIUsage: vi.fn(async () => {}),
  assertBudget: vi.fn(async () => {}),
}));
vi.mock("@/src/lib/topics", () => ({ ensureTopic: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    topicPaper: { findMany: vi.fn(), upsert: vi.fn() },
    paper: { upsert: vi.fn() },
    course: { findFirst: vi.fn(), findMany: vi.fn() },
    module: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    moduleVersion: { count: vi.fn() },
    moduleChunk: { deleteMany: vi.fn() },
    excerpt: { deleteMany: vi.fn() },
    courseModule: { upsert: vi.fn() },
    topic: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/src/lib/essay", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  generateEssayPromptWithFallback: vi.fn(async () => "Pertanyaan esai?"),
}));
vi.mock("@/src/lib/pages", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  expandModuleUntilFloor: vi.fn(),
}));
vi.mock("@/src/lib/verification", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  runVerification: vi.fn(),
}));

import { POST, buildSystem } from "./route";
import { prisma } from "@/src/lib/prisma";
import { generate, streamGenerate, embedTexts } from "@/src/lib/gemini";
import { assertBudget } from "@/src/lib/aiusage";
import { ensureTopic } from "@/src/lib/topics";
import { expandModuleUntilFloor } from "@/src/lib/pages";
import { runVerification } from "@/src/lib/verification";
import { OTHER_USER_ID, TEST_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

// Change 1 requires the jurusan to be *behavioural*, not a stored label: the
// synthesis prompt must actually carry the disciplinary lens, otherwise the same
// approved papers produce the same generic module for every major.
describe("buildSystem — disciplinary framing", () => {
  it("names the course in the system prompt", () => {
    expect(buildSystem("Teori Antropologi Kontemporer")).toContain(
      "Teori Antropologi Kontemporer",
    );
  });

  it("injects the major as an explicit disciplinary lens", () => {
    const withMajor = buildSystem("Teori Antropologi Kontemporer", "Antropologi");
    expect(withMajor).toContain("Antropologi");
    expect(withMajor.toLowerCase()).toContain("jurusan");
    // Explicitly instructs against the generic cross-disciplinary summary.
    expect(withMajor.toLowerCase()).toContain("lintas-disiplin");
  });

  it("produces a different prompt per major for the same course", () => {
    const a = buildSystem("Teori Sosial", "Antropologi");
    const b = buildSystem("Teori Sosial", "Sosiologi");
    expect(a).not.toBe(b);
    expect(b).toContain("Sosiologi");
    expect(b).not.toContain("Antropologi");
  });

  it("omits the framing block entirely when the course has no major", () => {
    const none = buildSystem("Teori Sosial");
    expect(none.toLowerCase()).not.toContain("jurusan");
    expect(none).not.toContain("undefined");
  });

  it("keeps the grounding + citation invariants regardless of major", () => {
    // The major must never displace the anti-hallucination instructions (I5).
    for (const prompt of [buildSystem("MK"), buildSystem("MK", "Antropologi")]) {
      expect(prompt).toContain("HANYA informasi dari paper yang diberikan");
      expect(prompt).toContain("Sitasi inline WAJIB");
      expect(prompt).toContain("Sources:");
    }
  });

  it("drops the 5000-word/padding floor in favour of depth and no-restatement", () => {
    const prompt = buildSystem("MK", "Antropologi");
    // The old page-count floor must be gone.
    expect(prompt).not.toContain("5000 kata");
    expect(prompt).not.toContain("MINIMAL 10 HALAMAN");
    // New depth-over-length + no-repeat directive is present.
    expect(prompt).toContain("KEDALAMAN, BUKAN PANJANG");
    expect(prompt.toLowerCase()).toContain("jangan mengulang");
  });

  it("requires temporal (Kapan) and geographic/social (Di mana) grounding of concepts", () => {
    const prompt = buildSystem("MK", "Antropologi");
    expect(prompt).toContain("Kapan");
    expect(prompt).toContain("Di mana");
    expect(prompt.toLowerCase()).toContain("5w1h");
  });

  it("enforces one-claim-one-citation discipline (no lumping)", () => {
    const prompt = buildSystem("MK", "Antropologi");
    expect(prompt).toContain("TEPAT SATU sitasi");
    expect(prompt.toLowerCase()).toContain("jangan menumpuk");
    expect(prompt).toContain("Klaim tanpa sitasi = klaim terlarang");
  });
});

// ---------------------------------------------------------------------------
// POST /api/synthesize — tenancy
// ---------------------------------------------------------------------------

const db = prisma as unknown as {
  topicPaper: { findMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  paper: { upsert: ReturnType<typeof vi.fn> };
  course: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  module: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  moduleVersion: { count: ReturnType<typeof vi.fn> };
  courseModule: { upsert: ReturnType<typeof vi.fn> };
  topic: { updateMany: ReturnType<typeof vi.fn> };
};
const gen = generate as unknown as ReturnType<typeof vi.fn>;
const stream = streamGenerate as unknown as ReturnType<typeof vi.fn>;
const embed = embedTexts as unknown as ReturnType<typeof vi.fn>;
const budget = assertBudget as unknown as ReturnType<typeof vi.fn>;
const topics = ensureTopic as unknown as ReturnType<typeof vi.fn>;

const MY_TOPIC = "t-mine";
const APPROVED = [
  {
    paper: {
      title: "Outline of a Theory of Practice",
      authors: "Bourdieu, P.",
      year: 1977,
      abstract: "Habitus names the durable dispositions agents acquire.",
      sourceUrl: "https://openalex.org/W1",
      citationCount: 1200,
      relevanceScore: 0.9,
      fullTextAvailable: true,
      doi: null, venue: null, volume: null, issue: null, pages: null, publisher: null,
      type: "article", providers: "openalex",
    },
  },
];

function makeReq(body: unknown, headers: { get: (name: string) => string | null }) {
  return { json: async () => body, headers } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  budget.mockResolvedValue(undefined);
  embed.mockResolvedValue([]);
  gen.mockResolvedValue({
    text: "## Tujuan Pembelajaran\n\nHabitus adalah disposisi [1].\n\nSources:\n1. Bourdieu",
    usage: { promptTokens: 10, candidatesTokens: 20 },
  });
  // Fake TABLE: approved papers are visible only through a topic the caller owns,
  // which is how the route scopes TopicPaper (it has no owner column of its own).
  db.topicPaper.findMany.mockImplementation(
    async ({ where }: { where: { topicId: string; topic: { ownerId: string } } }) =>
      where.topicId === MY_TOPIC && where.topic?.ownerId === TEST_USER_ID ? APPROVED : [],
  );
  db.topicPaper.upsert.mockResolvedValue({});
  db.paper.upsert.mockResolvedValue({ id: "p1" });
  topics.mockResolvedValue({ id: MY_TOPIC, courseId: "c-mine", ownerId: TEST_USER_ID });
  db.course.findFirst.mockImplementation(async ({ where }: { where: { ownerId: string } }) =>
    where.ownerId === TEST_USER_ID
      ? { id: "c-mine", name: "Antropologi Ekologi", major: "Antropologi" }
      : null,
  );
  // Only "c-mine" belongs to the caller; "c-hers" is the other student's course.
  db.course.findMany.mockImplementation(
    async ({ where }: { where: { id: { in: string[] }; ownerId: string } }) =>
      where.ownerId === TEST_USER_ID
        ? where.id.in.filter((id) => id === "c-mine").map((id) => ({ id }))
        : [],
  );
  db.module.findFirst.mockResolvedValue(null);
  db.module.create.mockResolvedValue({ id: "m-new" });
  db.courseModule.upsert.mockResolvedValue({});
  db.topic.updateMany.mockResolvedValue({ count: 1 });
  (expandModuleUntilFloor as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    finalText: "## Tujuan Pembelajaran\n\nHabitus adalah disposisi [1].",
    passes: 0,
    metFloor: true,
    wordCount: 5200,
    pageCount: 11,
    complete: true,
  });
  (runVerification as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    tier1: { blocked: false, findings: [], citations: { phantom: 0 } },
    critic: null,
    gauge: { band: "baik", score: 1, flagCount: 0 },
  });
});

describe("POST /api/synthesize — tenancy", () => {
  it("401s with NO paid call and NO budget query — the 401 is decided from the cookie alone", async () => {
    const res = await POST(
      makeReq({ topicId: MY_TOPIC, title: "Habitus" }, anonymousHeaders()),
    );
    expect(res.status).toBe(401);
    // This is the expensive route: the session gate sits in front of the budget
    // check, every DB read and every Gemini transport (stream + JSON fallback +
    // embeddings). An anonymous caller can neither spend the shared key nor infer
    // budget state from a 429-vs-200.
    expect(budget).not.toHaveBeenCalled();
    expect(gen).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(db.topicPaper.findMany).not.toHaveBeenCalled();
    expect(topics).not.toHaveBeenCalled();
    expect(db.module.create).not.toHaveBeenCalled();
  });

  it("401s even when the client asks for SSE — no half-open stream, no stream call", async () => {
    const res = await POST(
      makeReq(
        { topicId: MY_TOPIC, title: "Habitus" },
        anonymousHeaders({ accept: "text/event-stream" }),
      ),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(stream).not.toHaveBeenCalled();
  });

  it("synthesizes for the owner and stamps ownerId on the created module", async () => {
    const res = await POST(
      makeReq(
        { topicId: MY_TOPIC, title: "Habitus", courseId: "c-mine", courseIds: ["c-hers"] },
        await authedHeaders(),
      ),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { moduleId: string; topicId: string; stored: boolean };
    expect(json).toMatchObject({ moduleId: "m-new", topicId: MY_TOPIC, stored: true });

    // Approved papers are read through the topic's owner...
    expect(db.topicPaper.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { topicId: MY_TOPIC, approved: true, topic: { ownerId: TEST_USER_ID } },
      }),
    );
    // ...the topic is resolved through the owner-scoped helper's object signature...
    expect(topics).toHaveBeenCalledWith({
      ownerId: TEST_USER_ID,
      title: "Habitus",
      topicId: MY_TOPIC,
      courseId: "c-mine",
    });
    // ...the disciplinary lens comes from the caller's OWN course...
    expect(db.course.findFirst).toHaveBeenCalledWith({
      where: { id: "c-mine", ownerId: TEST_USER_ID },
    });
    // ...the module row carries its owner (schema: Module.ownerId is required)...
    expect(db.module.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: TEST_USER_ID, topicId: MY_TOPIC }),
      }),
    );
    // ...and the topic status update is scoped, not a bare update-by-id.
    expect(db.topic.updateMany).toHaveBeenCalledWith({
      where: { id: MY_TOPIC, ownerId: TEST_USER_ID },
      data: { status: "module_generated" },
    });
  });

  it("links ONLY the courses the caller owns, silently dropping the other student's", async () => {
    await POST(
      makeReq(
        { topicId: MY_TOPIC, title: "Habitus", courseId: "c-mine", courseIds: ["c-hers"] },
        await authedHeaders(),
      ),
    );
    expect(db.course.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["c-mine", "c-hers"] }, ownerId: TEST_USER_ID },
      select: { id: true },
    });
    // One link, for the owned course. A guessed courseId must not file this module
    // into someone else's matakuliah — and must not fail the paid synthesis either.
    expect(db.courseModule.upsert).toHaveBeenCalledTimes(1);
    expect(db.courseModule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId_moduleId: { courseId: "c-mine", moduleId: "m-new" } },
      }),
    );
  });

  it("another student's topicId yields the ordinary 'no approved papers' 400 — and no Gemini call", async () => {
    const res = await POST(
      makeReq({ topicId: MY_TOPIC, title: "Habitus" }, await authedHeaders(OTHER_USER_ID)),
    );
    // Deliberately the SAME 400 a topic with nothing approved gets: the response
    // must not distinguish "not yours" from "nothing approved yet", or it confirms
    // that a guessed topicId is real.
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Belum ada paper yang disetujui");
    // Nothing was generated, nothing was written.
    expect(gen).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
    expect(db.module.create).not.toHaveBeenCalled();
    expect(db.paper.upsert).not.toHaveBeenCalled();
  });

  it("keeps the budget gate: 429 before any Gemini call, after the session check", async () => {
    budget.mockRejectedValueOnce(new Error("Anggaran AI harian sudah habis: ..."));
    const res = await POST(makeReq({ topicId: MY_TOPIC, title: "Habitus" }, await authedHeaders()));
    expect(res.status).toBe(429);
    expect(gen).not.toHaveBeenCalled();
    // The budget gate still runs BEFORE the approved-paper read it used to guard.
    expect(db.topicPaper.findMany).not.toHaveBeenCalled();
  });

  it("still rejects an over-long title before spending anything", async () => {
    const res = await POST(
      makeReq({ topicId: MY_TOPIC, title: "x".repeat(400) }, await authedHeaders()),
    );
    expect(res.status).toBe(413);
    // Cheap input guards run after auth but before the budget query.
    expect(budget).not.toHaveBeenCalled();
    expect(gen).not.toHaveBeenCalled();
  });
});
