import { describe, expect, it, vi, beforeEach } from "vitest";
import { TEST_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

vi.mock("@/src/lib/prisma", () => {
  const topic = { findFirst: vi.fn() };
  const aIUsage = { create: vi.fn() };
  return { prisma: { topic, aIUsage } };
});
vi.mock("@/src/lib/gemini", () => ({
  generate: vi.fn(),
}));
vi.mock("@/src/lib/aiusage", () => ({
  logAIUsage: vi.fn(async () => {}),
  assertBudget: vi.fn(async () => {}),
}));

import { POST } from "./route";
import { prisma } from "@/src/lib/prisma";
import { generate } from "@/src/lib/gemini";
import { assertBudget } from "@/src/lib/aiusage";

const topic = prisma.topic as unknown as { findFirst: ReturnType<typeof vi.fn> };
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

describe("POST /api/grade", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    budget.mockResolvedValue(undefined);
    topic.findFirst.mockResolvedValue({ id: "t1", course: { name: "Antropologi" } });
    gen.mockResolvedValue({ text: "Umpan balik terperinci.", usage: { promptTokens: 10, candidatesTokens: 20 } });
  });

  it("rejects a missing studentAnswer with 400", async () => {
    const res = await POST(await makeReq({ questionText: "Q?", studentAnswer: "   " }));
    expect(res.status).toBe(400);
  });

  it("grades the essay via Gemini and returns grounded feedback", async () => {
    const res = await POST(
      await makeReq({ topicId: "t1", questionText: "Jelaskan habitus", studentAnswer: "Habitus adalah...", rubric: "1. Definisi" }),
    );
    expect(res.status).toBe(200);
    expect(gen).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { feedback: string };
    expect(body.feedback).toContain("Umpan balik");
  });

  it("grades without a topicId at all (generic course name, no DB read)", async () => {
    const res = await POST(await makeReq({ studentAnswer: "Jawaban esai yang cukup panjang." }));
    expect(res.status).toBe(200);
    expect(topic.findFirst).not.toHaveBeenCalled();
    expect(gen.mock.calls[0][0].system as string).toContain("mata kuliah ini");
  });

  it("returns 502 when the model call fails instead of inventing a grade", async () => {
    gen.mockRejectedValue(new Error("upstream down"));
    const res = await POST(await makeReq({ studentAnswer: "Jawaban esai yang cukup panjang." }));
    expect(res.status).toBe(502);
  });

  it("returns 429 with no Gemini call when the budget is blocked", async () => {
    budget.mockRejectedValue(new Error("Anggaran AI harian sudah habis: ..."));
    const res = await POST(await makeReq({ studentAnswer: "Jawaban esai yang cukup panjang." }));
    expect(res.status).toBe(429);
    expect(gen).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("anggaran");
  });

  // ---- tenancy ------------------------------------------------------------

  it("401s a request with no session cookie, BEFORE probing the budget", async () => {
    const res = await POST(anonReq({ topicId: "t1", studentAnswer: "Jawaban esai." }));
    expect(res.status).toBe(401);
    expect(budget).not.toHaveBeenCalled();
    expect(topic.findFirst).not.toHaveBeenCalled();
    expect(gen).not.toHaveBeenCalled();
  });

  it("404s another student's topicId rather than leaking her course name", async () => {
    topic.findFirst.mockResolvedValue(null);
    const res = await POST(await makeReq({ topicId: "her-topic", studentAnswer: "Jawaban esai." }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Topik tidak ditemukan." });
    expect(budget).not.toHaveBeenCalled();
    expect(gen).not.toHaveBeenCalled();
  });

  it("looks the topic up by id AND owner", async () => {
    await POST(await makeReq({ topicId: "t1", studentAnswer: "Jawaban esai." }));
    expect(topic.findFirst).toHaveBeenCalledWith({
      where: { id: "t1", ownerId: TEST_USER_ID },
      include: { course: true },
    });
    // The caller's own course name still frames the prompt.
    expect(gen.mock.calls[0][0].system as string).toContain("Antropologi");
  });
});
