import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const aIUsage = { create: vi.fn() };
  return { prisma: { aIUsage } };
});
vi.mock("@/src/lib/gemini", () => ({
  generate: vi.fn(),
}));
vi.mock("@/src/lib/aiusage", () => ({
  logAIUsage: vi.fn(async () => {}),
}));

import { POST } from "./route";
import { generate } from "@/src/lib/gemini";

const gen = generate as unknown as ReturnType<typeof vi.fn>;

function makeReq(body: unknown, contentLength?: string) {
  return {
    json: async () => body,
    headers: { get: (h: string) => (h === "content-length" ? (contentLength ?? null) : null) },
  } as never;
}

describe("POST /api/mcq (harness-first)", () => {
  beforeEach(() => {
    gen.mockReset();
  });

  it("rejects a missing module text with 400", async () => {
    const res = await POST(makeReq({ text: "   " }));
    expect(res.status).toBe(400);
  });

  it("generates deterministically with NO Gemini call by default", async () => {
    const res = await POST(
      makeReq({ text: "Habitus adalah disposisi terinternalisasi. Modal budaya diturunkan dari keluarga.", count: 3 }),
    );
    expect(res.status).toBe(200);
    expect(gen).not.toHaveBeenCalled();
    const body = (await res.json()) as { questions: { stem: string }[]; generatedBy: string };
    expect(body.generatedBy).toBe("fallback");
    expect(body.questions.length).toBeGreaterThan(0);
  });

  it("falls back to the harness when useLLM is set but the model fails", async () => {
    gen.mockRejectedValue(new Error("upstream"));
    const res = await POST(
      makeReq({ text: "Habitus adalah disposisi terinternalisasi bourdieu.", count: 2, useLLM: true }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { generatedBy: string };
    expect(body.generatedBy).toBe("fallback");
  });
});
