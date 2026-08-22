import { describe, expect, it, vi, beforeEach } from "vitest";
import { TEST_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

// Backup was the widest leak in the app: GET dumped every table, POST upserted
// by primary key. So this suite is deliberately data-driven — the prisma mock
// APPLIES the `where` clause the route passes instead of ignoring it, which is
// the only way an assertion like "her rows are absent from my export" can fail
// when the scoping is dropped.
vi.mock("@/src/lib/prisma", () => {
  const make = () => ({
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
    upsert: vi.fn(async () => ({})),
  });
  const prisma = {
    paper: make(),
    course: make(),
    topic: make(),
    module: make(),
    courseModule: make(),
    moduleChunk: make(),
    excerpt: make(),
    moduleVersion: make(),
    qASession: make(),
    assessmentAttempt: make(),
    questionBankItem: make(),
    aIUsage: make(),
    rPSReconcile: make(),
    topicPaper: make(),
    $transaction: vi.fn(async (fn: (p: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});

import { GET, POST } from "./route";
import { prisma } from "@/src/lib/prisma";

type Delegate = {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};

const db = prisma as unknown as Record<string, Delegate> & { $transaction: ReturnType<typeof vi.fn> };

const MINE = TEST_USER_ID;
const HERS = "test-user-intruder";

/** Rows tagged with the student they belong to. `_owner` is a test marker only. */
const FIXTURES: Record<string, Array<Record<string, unknown> & { _owner: string }>> = {
  paper: [
    { id: "p-mine", title: "Habitus", _owner: MINE },
    { id: "p-hers", title: "Gender", _owner: HERS },
  ],
  course: [
    { id: "c-mine", name: "Antropologi", ownerId: MINE, _owner: MINE },
    { id: "c-hers", name: "Sosiologi", ownerId: HERS, _owner: HERS },
  ],
  topic: [
    { id: "t-mine", courseId: "c-mine", ownerId: MINE, _owner: MINE },
    { id: "t-hers", courseId: "c-hers", ownerId: HERS, _owner: HERS },
  ],
  module: [
    { id: "m-mine", topicId: "t-mine", ownerId: MINE, _owner: MINE },
    { id: "m-hers", topicId: "t-hers", ownerId: HERS, _owner: HERS },
  ],
  courseModule: [
    { id: "cm-mine", courseId: "c-mine", moduleId: "m-mine", _owner: MINE },
    { id: "cm-hers", courseId: "c-hers", moduleId: "m-hers", _owner: HERS },
  ],
  moduleChunk: [
    { id: "ch-mine", moduleId: "m-mine", text: "cuplikan saya", _owner: MINE },
    { id: "ch-hers", moduleId: "m-hers", text: "cuplikan dia", _owner: HERS },
  ],
  excerpt: [
    { id: "ex-mine", moduleId: "m-mine", paperId: "p-mine", _owner: MINE },
    { id: "ex-hers", moduleId: "m-hers", paperId: "p-hers", _owner: HERS },
  ],
  moduleVersion: [
    { id: "mv-mine", moduleId: "m-mine", version: 1, _owner: MINE },
    { id: "mv-hers", moduleId: "m-hers", version: 1, _owner: HERS },
  ],
  qASession: [
    { id: "qa-mine", topicId: "t-mine", messages: "[]", _owner: MINE },
    { id: "qa-hers", topicId: "t-hers", messages: "[]", _owner: HERS },
  ],
  assessmentAttempt: [
    { id: "a-mine", topicId: "t-mine", moduleId: "m-mine", _owner: MINE },
    { id: "a-hers", topicId: "t-hers", moduleId: "m-hers", _owner: HERS },
  ],
  questionBankItem: [
    { id: "qb-mine", topicId: "t-mine", stem: "?", _owner: MINE },
    { id: "qb-hers", topicId: "t-hers", stem: "?", _owner: HERS },
  ],
  aIUsage: [
    { id: "u-mine", topicId: "t-mine", kind: "qa", _owner: MINE },
    { id: "u-hers", topicId: "t-hers", kind: "qa", _owner: HERS },
    { id: "u-shared", topicId: null, kind: "mcq", _owner: "shared" },
  ],
  rPSReconcile: [
    { id: "r-mine", courseId: "c-mine", _owner: MINE },
    { id: "r-hers", courseId: "c-hers", _owner: HERS },
  ],
  topicPaper: [
    { topicId: "t-mine", paperId: "p-mine", _owner: MINE },
    { topicId: "t-hers", paperId: "p-hers", _owner: HERS },
  ],
};

/** The ownerId the route folded into a `where`, however deeply nested. */
function scopedOwner(where: unknown): string | null {
  if (where == null || typeof where !== "object") return null;
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === "ownerId" && typeof value === "string") return value;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = scopedOwner(entry);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = scopedOwner(value);
      if (found) return found;
    }
  }
  return null;
}

/** Stand-in query engine: honours the owner filter, refuses an unscoped read. */
function applyWhere(table: string, where: unknown) {
  const rows = FIXTURES[table] ?? [];
  if (table === "aIUsage") {
    // AIUsage has no owner column; the route bounds it by the caller's topic ids.
    const or = (where as { OR?: Array<Record<string, unknown>> })?.OR ?? [];
    const ids = (or[0]?.topicId as { in?: string[] } | undefined)?.in ?? [];
    const allowsNull = or.some((c) => c.topicId === null);
    return rows.filter(
      (r) =>
        (typeof r.topicId === "string" && ids.includes(r.topicId)) ||
        (allowsNull && r.topicId == null),
    );
  }
  const owner = scopedOwner(where);
  // An unscoped findMany is the bug this file exists to prevent: fail loudly
  // rather than quietly returning everything (which is what production did).
  if (!owner) throw new Error(`unscoped findMany on ${table}: ${JSON.stringify(where)}`);
  return rows.filter((r) => r._owner === owner);
}

async function authedReq() {
  return { headers: await authedHeaders() } as unknown as Request;
}

async function makeReq(body: unknown) {
  return { json: async () => body, headers: await authedHeaders() } as never;
}

function anonReq(body: unknown) {
  return { json: async () => body, headers: anonymousHeaders() } as never;
}

beforeEach(() => {
  for (const table of Object.keys(FIXTURES)) {
    db[table].findMany.mockReset();
    db[table].findFirst.mockReset();
    db[table].upsert.mockReset();
    db[table].findMany.mockImplementation(async (args: { where?: unknown }) =>
      applyWhere(table, args?.where),
    );
    db[table].findFirst.mockResolvedValue(null);
    db[table].upsert.mockResolvedValue({});
  }
  db.$transaction.mockReset();
  db.$transaction.mockImplementation(async (fn: (p: unknown) => unknown) => fn(prisma));
});

describe("GET /api/backup", () => {
  it("401s a request with no session cookie and reads nothing", async () => {
    const res = await GET({ headers: anonymousHeaders() } as unknown as Request);
    expect(res.status).toBe(401);
    expect(db.topic.findMany).not.toHaveBeenCalled();
  });

  it("returns a versioned snapshot with every data table present", async () => {
    const res = await GET(await authedReq());
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      exportedAt: string;
      version: number;
      data: Record<string, unknown[]>;
    };
    expect(json.version).toBe(1);
    expect(typeof json.exportedAt).toBe("string");
    for (const key of [
      "courses",
      "topics",
      "papers",
      "topicPapers",
      "modules",
      "courseModules",
      "moduleChunks",
      "excerpts",
      "moduleVersions",
      "qaSessions",
      "assessmentAttempts",
      "questionBankItems",
      "aiUsage",
      "rpsReconciles",
    ]) {
      expect(json.data).toHaveProperty(key);
      expect(Array.isArray(json.data[key])).toBe(true);
    }
    expect(db.course.findMany).toHaveBeenCalledWith({ where: { ownerId: MINE } });
  });

  it("exports ONLY the caller's rows — not one row of the other student's", async () => {
    const res = await GET(await authedReq());
    const json = (await res.json()) as { data: Record<string, Array<{ id?: string; _owner?: string }>> };

    // The whole point: no table may contain a row tagged as hers.
    const foreign = Object.entries(json.data).flatMap(([table, rows]) =>
      rows.filter((r) => r._owner === HERS).map((r) => `${table}:${r.id ?? JSON.stringify(r)}`),
    );
    expect(foreign).toEqual([]);

    // And the caller's own rows are all there (a scoped export is useless if it
    // scopes everything away).
    expect(json.data.courses.map((r) => r.id)).toEqual(["c-mine"]);
    expect(json.data.topics.map((r) => r.id)).toEqual(["t-mine"]);
    expect(json.data.modules.map((r) => r.id)).toEqual(["m-mine"]);
    expect(json.data.moduleChunks.map((r) => r.id)).toEqual(["ch-mine"]);
    expect(json.data.assessmentAttempts.map((r) => r.id)).toEqual(["a-mine"]);
    expect(json.data.questionBankItems.map((r) => r.id)).toEqual(["qb-mine"]);
    expect(json.data.qaSessions.map((r) => r.id)).toEqual(["qa-mine"]);
    expect(json.data.rpsReconciles.map((r) => r.id)).toEqual(["r-mine"]);
    expect(json.data.topicPapers).toHaveLength(1);
  });

  it("exports the shared papers it references, not the whole global table", async () => {
    const res = await GET(await authedReq());
    const json = (await res.json()) as { data: { papers: Array<{ id: string }> } };
    // Paper is global and deduplicated on purpose, so it is NOT owner-filtered as
    // a model — but "which papers" still says what the caller has been reading.
    expect(json.data.papers.map((p) => p.id)).toEqual(["p-mine"]);
    expect(db.paper.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { topicPapers: { some: { topic: { ownerId: MINE } } } },
          { excerpts: { some: { module: { ownerId: MINE } } } },
        ],
      },
    });
  });

  it("keeps unattributed AIUsage but drops rows pointing at her topics", async () => {
    const res = await GET(await authedReq());
    const json = (await res.json()) as { data: { aiUsage: Array<{ id: string }> } };
    // Shared-wallet spend with no topic stays (both students already see it in
    // /api/usage); a row naming her topic would disclose her topic ids.
    expect(json.data.aiUsage.map((r) => r.id).sort()).toEqual(["u-mine", "u-shared"]);
  });

  it("scopes child tables through the relation that reaches an owner", async () => {
    await GET(await authedReq());
    expect(db.moduleChunk.findMany).toHaveBeenCalledWith({ where: { module: { ownerId: MINE } } });
    expect(db.excerpt.findMany).toHaveBeenCalledWith({ where: { module: { ownerId: MINE } } });
    expect(db.moduleVersion.findMany).toHaveBeenCalledWith({ where: { module: { ownerId: MINE } } });
    expect(db.courseModule.findMany).toHaveBeenCalledWith({ where: { course: { ownerId: MINE } } });
    expect(db.rPSReconcile.findMany).toHaveBeenCalledWith({ where: { course: { ownerId: MINE } } });
    expect(db.qASession.findMany).toHaveBeenCalledWith({ where: { topic: { ownerId: MINE } } });
    expect(db.assessmentAttempt.findMany).toHaveBeenCalledWith({ where: { topic: { ownerId: MINE } } });
    expect(db.questionBankItem.findMany).toHaveBeenCalledWith({ where: { topic: { ownerId: MINE } } });
    expect(db.topicPaper.findMany).toHaveBeenCalledWith({ where: { topic: { ownerId: MINE } } });
  });
});

describe("POST /api/backup", () => {
  /** Make `findFirst` answer like the real DB for a set of existing rows. */
  function wireExisting(table: string, rows: Array<Record<string, unknown> & { _owner: string }>) {
    db[table].findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const id = args.where.id as string | undefined;
      const owner = scopedOwner(args.where);
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      // A scoped lookup only sees the row when the owner matches.
      if (owner && row._owner !== owner) return null;
      return row;
    });
  }

  it("401s an import with no session cookie and writes nothing", async () => {
    const res = await POST(anonReq({ confirm: "overwrite", data: { courses: [{ id: "c1", name: "X" }] } }));
    expect(res.status).toBe(401);
    expect(db.course.upsert).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an import without confirm: overwrite", async () => {
    const res = await POST(await makeReq({ data: { courses: [{ id: "c1", name: "X" }] } }));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed payload", async () => {
    const res = await POST(await makeReq({ confirm: "overwrite", data: 42 }));
    expect(res.status).toBe(400);
  });

  it("round-trips a small valid payload and reports counts", async () => {
    // Nothing exists yet; the parents arrive in the same file, so ownership is
    // registered as each one is written.
    const payload = {
      confirm: "overwrite",
      data: {
        courses: [{ id: "c1", name: "Antropologi", major: null }],
        topics: [{ id: "t1", courseId: "c1", title: "Habitus", status: "ready" }],
        papers: [{ id: "p1", title: "Practice", sourceUrl: "https://x/1" }],
        topicPapers: [{ topicId: "t1", paperId: "p1", approved: true }],
        modules: [{ id: "m1", topicId: "t1", contentMarkdown: "# x", sourcePaperIds: "[]" }],
        assessmentAttempts: [
          { id: "a1", moduleId: "m1", topicId: "t1", questionType: "mcq", itemRef: "q1", prompt: "?" },
        ],
      },
    };
    const res = await POST(await makeReq(payload));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; counts: Record<string, number>; skipped: Record<string, number> };
    expect(json.ok).toBe(true);
    expect(json.counts.courses).toBe(1);
    expect(json.counts.topics).toBe(1);
    expect(json.counts.papers).toBe(1);
    expect(json.counts.topicPapers).toBe(1);
    expect(json.counts.modules).toBe(1);
    expect(json.counts.assessmentAttempts).toBe(1);
    expect(json.skipped.courses).toBe(0);
    // Wrote within a single transaction.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("stamps the caller's ownerId and ignores the ownerId inside the file", async () => {
    const payload = {
      confirm: "overwrite",
      // A file exported from HER account still carries her ownerId.
      data: { courses: [{ id: "c9", name: "Sosiologi", ownerId: HERS }] },
    };
    const res = await POST(await makeReq(payload));
    expect(res.status).toBe(200);
    const call = db.course.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: "c9" });
    expect((call.create as { ownerId: string }).ownerId).toBe(MINE);
    expect((call.update as { ownerId: string }).ownerId).toBe(MINE);
  });

  it("refuses to overwrite a course that already belongs to the other student", async () => {
    wireExisting("course", [FIXTURES.course[1]]); // c-hers exists, owned by her
    const payload = {
      confirm: "overwrite",
      data: { courses: [{ id: "c-hers", name: "Dirusak" }] },
    };
    const res = await POST(await makeReq(payload));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { counts: Record<string, number>; skipped: Record<string, number> };
    expect(db.course.upsert).not.toHaveBeenCalled();
    expect(json.counts.courses).toBe(0);
    expect(json.skipped.courses).toBe(1);
  });

  it("refuses to hang new rows off the other student's topic", async () => {
    wireExisting("topic", [FIXTURES.topic[1]]); // t-hers is hers
    const payload = {
      confirm: "overwrite",
      data: {
        assessmentAttempts: [
          { id: "a-new", moduleId: "m-hers", topicId: "t-hers", questionType: "mcq", itemRef: "q", prompt: "?" },
        ],
        questionBankItems: [{ id: "qb-new", topicId: "t-hers", stem: "?", options: "[]", answer: "a", author: "student" }],
        qaSessions: [{ id: "qa-new", topicId: "t-hers", messages: "[]" }],
        topicPapers: [{ topicId: "t-hers", paperId: "p1" }],
      },
    };
    const res = await POST(await makeReq(payload));
    const json = (await res.json()) as { counts: Record<string, number>; skipped: Record<string, number> };
    expect(db.assessmentAttempt.upsert).not.toHaveBeenCalled();
    expect(db.questionBankItem.upsert).not.toHaveBeenCalled();
    expect(db.qASession.upsert).not.toHaveBeenCalled();
    expect(db.topicPaper.upsert).not.toHaveBeenCalled();
    expect(json.counts.assessmentAttempts).toBe(0);
    expect(json.skipped.topicPapers).toBe(1);
  });

  it("refuses to steal an existing child row by re-pointing it at my parent", async () => {
    // My topic/module are real; the attempt id, however, is hers.
    wireExisting("topic", [FIXTURES.topic[0]]);
    wireExisting("module", [FIXTURES.module[0]]);
    db.assessmentAttempt.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      const owner = scopedOwner(args.where);
      if (args.where.id !== "a-hers") return null;
      // Scoped through `topic: { ownerId }` it is invisible; unscoped it exists.
      return owner ? null : { id: "a-hers" };
    });
    const payload = {
      confirm: "overwrite",
      data: {
        assessmentAttempts: [
          { id: "a-hers", moduleId: "m-mine", topicId: "t-mine", questionType: "mcq", itemRef: "q", prompt: "?" },
        ],
      },
    };
    const res = await POST(await makeReq(payload));
    const json = (await res.json()) as { counts: Record<string, number>; skipped: Record<string, number> };
    expect(db.assessmentAttempt.upsert).not.toHaveBeenCalled();
    expect(json.skipped.assessmentAttempts).toBe(1);
  });

  it("keeps a shared paper importable (it is global by design)", async () => {
    const payload = {
      confirm: "overwrite",
      data: { papers: [{ id: "p-hers", title: "Gender", sourceUrl: "https://x/2" }] },
    };
    const res = await POST(await makeReq(payload));
    const json = (await res.json()) as { counts: Record<string, number> };
    expect(json.counts.papers).toBe(1);
    expect(db.paper.upsert).toHaveBeenCalledTimes(1);
  });

  it("drops an AIUsage row attributed to a topic that is not the caller's", async () => {
    wireExisting("topic", [FIXTURES.topic[0], FIXTURES.topic[1]]);
    const payload = {
      confirm: "overwrite",
      data: {
        aiUsage: [
          { id: "u1", topicId: "t-mine", kind: "qa", tokensIn: 1, tokensOut: 1, estimatedCost: 0 },
          { id: "u2", topicId: "t-hers", kind: "qa", tokensIn: 1, tokensOut: 1, estimatedCost: 0 },
          { id: "u3", topicId: null, kind: "mcq", tokensIn: 1, tokensOut: 1, estimatedCost: 0 },
        ],
      },
    };
    const res = await POST(await makeReq(payload));
    const json = (await res.json()) as { counts: Record<string, number>; skipped: Record<string, number> };
    expect(json.counts.aiUsage).toBe(2); // t-mine + the unattributed row
    expect(json.skipped.aiUsage).toBe(1);
  });
});
