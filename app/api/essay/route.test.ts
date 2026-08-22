import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    module: { findFirst: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/src/lib/essay", () => ({ generateEssayPromptWithFallback: vi.fn() }));
vi.mock("@/src/lib/aiusage", () => ({
  assertBudget: vi.fn(async () => {}),
}));

import { POST } from "./route";
import { prisma } from "@/src/lib/prisma";
import { generateEssayPromptWithFallback } from "@/src/lib/essay";
import { assertBudget } from "@/src/lib/aiusage";
import { OTHER_USER_ID, TEST_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

const mod = prisma.module as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const gen = generateEssayPromptWithFallback as unknown as ReturnType<typeof vi.fn>;
const budget = assertBudget as unknown as ReturnType<typeof vi.fn>;

/** The module in the fake database: "m1", owned by TEST_USER_ID. */
const MODULE_ROW = {
  id: "m1",
  ownerId: TEST_USER_ID,
  topicId: "t-mine",
  contentMarkdown: "modul …",
  topic: { title: "Teori Praktik" },
};

function makeReq(body: unknown, headers: { get: (name: string) => string | null }) {
  return { json: async () => body, headers } as never;
}

beforeEach(() => {
  mod.findFirst.mockReset();
  mod.update.mockReset();
  gen.mockReset();
  budget.mockReset();
  budget.mockResolvedValue(undefined);
  // Fake table rather than a canned row: the module answers only to its owner, so
  // a route that forgot `ownerId` would fail the 404 test below instead of
  // silently regenerating someone else's essay question.
  mod.findFirst.mockImplementation(
    async ({ where }: { where: { id: string; ownerId: string } }) =>
      where.id === MODULE_ROW.id && where.ownerId === MODULE_ROW.ownerId ? MODULE_ROW : null,
  );
});

describe("POST /api/essay", () => {
  it("regenerates the question and persists it on the module", async () => {
    gen.mockResolvedValue("Pertanyaan esai yang bagus?");
    const res = await POST(makeReq({ moduleId: "m1", topicId: "t1" }, await authedHeaders()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ essayPrompt: "Pertanyaan esai yang bagus?" });
    expect(mod.update).toHaveBeenCalledWith({
      // The write carries the owner next to the unique id, so the mutation is
      // bounded by the same predicate as the read.
      where: { id: "m1", ownerId: TEST_USER_ID },
      data: { essayPrompt: "Pertanyaan esai yang bagus?" },
    });
  });

  it("requires moduleId", async () => {
    const res = await POST(makeReq({ topicId: "t1" }, await authedHeaders()));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the module does not exist", async () => {
    const res = await POST(makeReq({ moduleId: "nope" }, await authedHeaders()));
    expect(res.status).toBe(404);
  });

  it("never ships a null prompt: persists whatever the fallback returns", async () => {
    mod.findFirst.mockResolvedValue({
      id: "m1",
      ownerId: TEST_USER_ID,
      topicId: "t-mine",
      contentMarkdown: "modul tentang strukturalisme",
    });
    // The fallback (harness or AI) always yields a non-null prompt; the route
    // must persist and return it rather than 502 / null.
    gen.mockResolvedValue("Tulis esai 5W1H tentang strukturalisme …");
    const res = await POST(makeReq({ moduleId: "m1", topicId: "t1" }, await authedHeaders()));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { essayPrompt?: string };
    expect(json.essayPrompt).toBeTruthy();
    expect(mod.update).toHaveBeenCalledWith({
      where: { id: "m1", ownerId: TEST_USER_ID },
      data: { essayPrompt: json.essayPrompt },
    });
  });
});

describe("POST /api/essay — tenancy", () => {
  it("401s with no session, before the budget query and before the paid call", async () => {
    const res = await POST(makeReq({ moduleId: "m1" }, anonymousHeaders()));
    expect(res.status).toBe(401);
    expect(mod.findFirst).not.toHaveBeenCalled();
    expect(budget).not.toHaveBeenCalled();
    expect(gen).not.toHaveBeenCalled();
    expect(mod.update).not.toHaveBeenCalled();
  });

  it("scopes the lookup by ownerId (findFirst, not findUnique by id)", async () => {
    gen.mockResolvedValue("Pertanyaan?");
    await POST(makeReq({ moduleId: "m1", topicId: "t-hers" }, await authedHeaders()));
    expect(mod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1", ownerId: TEST_USER_ID } }),
    );
    // The usage attribution uses the MODULE's own topic, not the unverified
    // `topicId` from the body — otherwise a caller could bill their spend to
    // another student's topic.
    expect(gen).toHaveBeenCalledWith("modul …", "t-mine", "Teori Praktik");
  });

  it("404s another student's moduleId: no Gemini call, no write", async () => {
    const res = await POST(makeReq({ moduleId: "m1" }, await authedHeaders(OTHER_USER_ID)));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Modul tidak ditemukan." });
    expect(gen).not.toHaveBeenCalled();
    expect(mod.update).not.toHaveBeenCalled();
    // The 404 lands before the budget gate, so probing ids cannot burn budget
    // either.
    expect(budget).not.toHaveBeenCalled();
  });

  it("still returns 429 when the budget is spent, for the caller's own module", async () => {
    budget.mockRejectedValueOnce(new Error("Anggaran AI harian sudah habis: ..."));
    const res = await POST(makeReq({ moduleId: "m1" }, await authedHeaders()));
    expect(res.status).toBe(429);
    expect(gen).not.toHaveBeenCalled();
  });
});
