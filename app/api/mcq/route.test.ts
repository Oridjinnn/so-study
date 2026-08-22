import { describe, expect, it, vi, beforeEach } from "vitest";
import { TEST_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

vi.mock("@/src/lib/prisma", () => {
  const aIUsage = { create: vi.fn() };
  const topic = { findFirst: vi.fn() };
  return { prisma: { aIUsage, topic } };
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

const gen = generate as unknown as ReturnType<typeof vi.fn>;
const budget = assertBudget as unknown as ReturnType<typeof vi.fn>;
const topic = prisma.topic as unknown as { findFirst: ReturnType<typeof vi.fn> };

const MODULE_TEXT = "Habitus adalah disposisi terinternalisasi. Modal budaya diturunkan dari keluarga.";

async function makeReq(body: unknown, contentLength?: string, userId?: string) {
  return {
    json: async () => body,
    headers: await authedHeaders(userId, contentLength ? { "content-length": contentLength } : {}),
  } as never;
}

function anonReq(body: unknown) {
  return { json: async () => body, headers: anonymousHeaders() } as never;
}

describe("POST /api/mcq (harness-first)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    budget.mockResolvedValue(undefined);
    topic.findFirst.mockResolvedValue({ id: "t1" });
  });

  it("rejects a missing module text with 400", async () => {
    const res = await POST(await makeReq({ text: "   " }));
    expect(res.status).toBe(400);
  });

  it("generates deterministically with NO Gemini call by default", async () => {
    const res = await POST(await makeReq({ text: MODULE_TEXT, count: 3 }));
    expect(res.status).toBe(200);
    expect(gen).not.toHaveBeenCalled();
    const body = (await res.json()) as { questions: { stem: string }[]; generatedBy: string };
    expect(body.generatedBy).toBe("fallback");
    expect(body.questions.length).toBeGreaterThan(0);
  });

  it("falls back to the harness when useLLM is set but the model fails", async () => {
    gen.mockRejectedValue(new Error("upstream"));
    const res = await POST(await makeReq({ text: MODULE_TEXT, count: 2, useLLM: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { generatedBy: string };
    expect(body.generatedBy).toBe("fallback");
  });

  it("returns 429 with no Gemini call when the budget is blocked", async () => {
    budget.mockRejectedValue(new Error("Anggaran AI harian sudah habis: ..."));
    const res = await POST(await makeReq({ text: MODULE_TEXT, count: 2, useLLM: true }));
    expect(res.status).toBe(429);
    expect(gen).not.toHaveBeenCalled();
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain("anggaran");
  });

  // ---- tenancy ------------------------------------------------------------

  it("401s a request with no session cookie, BEFORE probing the budget", async () => {
    const res = await POST(anonReq({ text: MODULE_TEXT, count: 2, useLLM: true }));
    expect(res.status).toBe(401);
    expect(budget).not.toHaveBeenCalled();
    expect(topic.findFirst).not.toHaveBeenCalled();
    expect(gen).not.toHaveBeenCalled();
  });

  it("404s another student's topicId instead of billing her topic", async () => {
    topic.findFirst.mockResolvedValue(null);
    const res = await POST(await makeReq({ text: MODULE_TEXT, topicId: "her-topic", useLLM: true }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Topik tidak ditemukan." });
    expect(budget).not.toHaveBeenCalled();
    expect(gen).not.toHaveBeenCalled();
  });

  it("verifies the topic through the session owner", async () => {
    await POST(await makeReq({ text: MODULE_TEXT, topicId: "t1" }));
    expect(topic.findFirst).toHaveBeenCalledWith({
      where: { id: "t1", ownerId: TEST_USER_ID },
      select: { id: true },
    });
  });
});
