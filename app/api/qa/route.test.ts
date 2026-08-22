import { describe, expect, it, vi, beforeEach } from "vitest";
import { TEST_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

vi.mock("@/src/lib/prisma", () => {
  const moduleChunk = { findMany: vi.fn() };
  const aIUsage = { create: vi.fn() };
  const topic = { findFirst: vi.fn() };
  // `moduleDelegate` rather than `module`: the bare name trips the Next.js lint
  // rule about assigning to the CommonJS `module` global.
  const moduleDelegate = { findFirst: vi.fn() };
  return { prisma: { moduleChunk, aIUsage, topic, module: moduleDelegate } };
});
vi.mock("@/src/lib/gemini", () => ({
  embedTexts: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("@/src/lib/aiusage", () => ({
  logAIUsage: vi.fn(async () => {}),
  // The budget guard is a cheap pre-flight check: by default it passes so the
  // existing paid-call assertions stay meaningful. Blocked-budget cases below
  // override it to throw.
  assertBudget: vi.fn(async () => {}),
}));

import { POST } from "./route";
import { prisma } from "@/src/lib/prisma";
import { embedTexts, generate } from "@/src/lib/gemini";
import { assertBudget } from "@/src/lib/aiusage";

const moduleChunk = prisma.moduleChunk as unknown as { findMany: ReturnType<typeof vi.fn> };
const topic = prisma.topic as unknown as { findFirst: ReturnType<typeof vi.fn> };
const mod = prisma.module as unknown as { findFirst: ReturnType<typeof vi.fn> };
const embed = embedTexts as unknown as ReturnType<typeof vi.fn>;
const gen = generate as unknown as ReturnType<typeof vi.fn>;
const budget = assertBudget as unknown as ReturnType<typeof vi.fn>;

async function makeReq(body: unknown, contentLength?: string, userId?: string) {
  return {
    json: async () => body,
    headers: await authedHeaders(userId, contentLength ? { "content-length": contentLength } : {}),
  } as never;
}

function anonReq(body: unknown) {
  return { json: async () => body, headers: anonymousHeaders() } as never;
}

const CHUNKS = [
  { id: "c1", text: "habitus adalah disposisi terinternalisasi bourdieu", embedding: JSON.stringify([1, 0, 0]) },
  { id: "c2", text: "ikan hiu hidup di laut dalam", embedding: JSON.stringify([0, 1, 0]) },
];

describe("POST /api/qa (RAG)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    budget.mockResolvedValue(undefined);
    mod.findFirst.mockResolvedValue({ id: "m1" });
    topic.findFirst.mockResolvedValue({ id: "t1" });
    moduleChunk.findMany.mockResolvedValue(CHUNKS);
    embed.mockResolvedValue([[0.9, 0.1, 0.1]]); // query embeddings: close to c1
    gen.mockResolvedValue({ text: "Jawaban dari modul.", usage: { promptTokens: 5, candidatesTokens: 8 } });
  });

  it("rejects a missing question with 400", async () => {
    const res = await POST(await makeReq({ moduleId: "m1" }));
    expect(res.status).toBe(400);
  });

  it("retrieves the most relevant chunk and injects it (dense over lexical)", async () => {
    const res = await POST(await makeReq({ moduleId: "m1", question: "jelaskan habitus bourdieu" }));
    expect(res.status).toBe(200);
    expect(gen).toHaveBeenCalledTimes(1);
    const prompt = gen.mock.calls[0][0].prompt as string;
    // The semantically-matching chunk must be in the injected context even though
    // it shares no lexical tokens with a paraphrase-free query handled by cosine.
    expect(prompt).toContain("habitus adalah disposisi terinternalisasi bourdieu");
  });

  it("answers from no context at all rather than fabricating", async () => {
    moduleChunk.findMany.mockResolvedValue([]);
    const res = await POST(await makeReq({ moduleId: "m1", question: "apa itu habitus" }));
    expect(res.status).toBe(200);
    const prompt = gen.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("tidak ada cuplikan modul");
  });

  it("returns 429 with no Gemini call when the budget is blocked", async () => {
    budget.mockRejectedValue(new Error("Anggaran AI harian sudah habis: ..."));
    const res = await POST(await makeReq({ moduleId: "m1", question: "apa itu habitus" }));
    expect(res.status).toBe(429);
    expect(embed).not.toHaveBeenCalled();
    expect(gen).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("anggaran");
  });

  // ---- tenancy ------------------------------------------------------------

  it("401s a request with no session cookie, BEFORE probing the budget", async () => {
    const res = await POST(anonReq({ moduleId: "m1", question: "apa itu habitus" }));
    expect(res.status).toBe(401);
    // Auth runs first: an anonymous caller learns nothing about the shared
    // budget, costs no DB query, and certainly spends no Gemini call.
    expect(budget).not.toHaveBeenCalled();
    expect(moduleChunk.findMany).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(gen).not.toHaveBeenCalled();
  });

  it("404s another student's moduleId without spending a call on it", async () => {
    mod.findFirst.mockResolvedValue(null);
    const res = await POST(await makeReq({ moduleId: "her-module", question: "apa isi modulnya" }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Modul tidak ditemukan." });
    expect(budget).not.toHaveBeenCalled();
    expect(moduleChunk.findMany).not.toHaveBeenCalled();
    expect(gen).not.toHaveBeenCalled();
  });

  it("404s another student's topicId (it would be stamped on the cost row)", async () => {
    topic.findFirst.mockResolvedValue(null);
    const res = await POST(await makeReq({ topicId: "her-topic", question: "apa itu habitus" }));
    expect(res.status).toBe(404);
    expect(gen).not.toHaveBeenCalled();
  });

  it("reads chunks through the module owner, never by moduleId alone", async () => {
    await POST(await makeReq({ moduleId: "m1", question: "jelaskan habitus" }));
    expect(moduleChunk.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { moduleId: "m1", module: { ownerId: TEST_USER_ID } },
      }),
    );
    expect(mod.findFirst).toHaveBeenCalledWith({
      where: { id: "m1", ownerId: TEST_USER_ID },
      select: { id: true },
    });
  });
});
