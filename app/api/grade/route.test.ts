import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const topic = { findUnique: vi.fn() };
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

const topic = prisma.topic as unknown as { findUnique: ReturnType<typeof vi.fn> };
const gen = generate as unknown as ReturnType<typeof vi.fn>;
const budget = assertBudget as unknown as ReturnType<typeof vi.fn>;

function makeReq(body: unknown, contentLength?: string) {
  return {
    json: async () => body,
    headers: { get: (h: string) => (h === "content-length" ? (contentLength ?? null) : null) },
  } as never;
}

describe("POST /api/grade", () => {
  beforeEach(() => {
    topic.findUnique.mockReset();
    gen.mockReset();
    budget.mockReset();
    budget.mockResolvedValue(undefined);
    // Unknown topic → generic course name, no DB failure.
    topic.findUnique.mockResolvedValue(null);
    gen.mockResolvedValue({ text: "Umpan balik terperinci.", usage: { promptTokens: 10, candidatesTokens: 20 } });
  });

  it("rejects a missing studentAnswer with 400", async () => {
    const res = await POST(makeReq({ questionText: "Q?", studentAnswer: "   " }));
    expect(res.status).toBe(400);
  });

  it("grades the essay via Gemini and returns grounded feedback", async () => {
    const res = await POST(makeReq({ topicId: "t1", questionText: "Jelaskan habitus", studentAnswer: "Habitus adalah...", rubric: "1. Definisi" }));
    expect(res.status).toBe(200);
    expect(gen).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { feedback: string };
    expect(body.feedback).toContain("Umpan balik");
  });

  it("returns 502 when the model call fails instead of inventing a grade", async () => {
    gen.mockRejectedValue(new Error("upstream down"));
    const res = await POST(makeReq({ studentAnswer: "Jawaban esai yang cukup panjang." }));
    expect(res.status).toBe(502);
  });

  it("returns 429 with no Gemini call when the budget is blocked", async () => {
    budget.mockRejectedValue(new Error("Anggaran AI harian sudah habis: ..."));
    const res = await POST(makeReq({ studentAnswer: "Jawaban esai yang cukup panjang." }));
    expect(res.status).toBe(429);
    expect(gen).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("anggaran");
  });
});
