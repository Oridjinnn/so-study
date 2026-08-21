import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    module: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("@/src/lib/essay", () => ({ generateEssayPromptWithFallback: vi.fn() }));

import { POST } from "./route";
import { prisma } from "@/src/lib/prisma";
import { generateEssayPromptWithFallback } from "@/src/lib/essay";

const mod = prisma.module as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const gen = generateEssayPromptWithFallback as unknown as ReturnType<typeof vi.fn>;

function makeReq(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as never;
}

beforeEach(() => {
  mod.findUnique.mockReset();
  mod.update.mockReset();
  gen.mockReset();
});

describe("POST /api/essay", () => {
  it("regenerates the question and persists it on the module", async () => {
    mod.findUnique.mockResolvedValue({ id: "m1", contentMarkdown: "modul …" });
    gen.mockResolvedValue("Pertanyaan esai yang bagus?");
    const res = await POST(makeReq({ moduleId: "m1", topicId: "t1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ essayPrompt: "Pertanyaan esai yang bagus?" });
    expect(mod.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { essayPrompt: "Pertanyaan esai yang bagus?" },
    });
  });

  it("requires moduleId", async () => {
    const res = await POST(makeReq({ topicId: "t1" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the module does not exist", async () => {
    mod.findUnique.mockResolvedValue(null);
    const res = await POST(makeReq({ moduleId: "nope" }));
    expect(res.status).toBe(404);
  });

  it("never ships a null prompt: persists whatever the fallback returns", async () => {
    mod.findUnique.mockResolvedValue({ id: "m1", contentMarkdown: "modul tentang strukturalisme" });
    // The fallback (harness or AI) always yields a non-null prompt; the route
    // must persist and return it rather than 502 / null.
    gen.mockResolvedValue("Tulis esai 5W1H tentang strukturalisme …");
    const res = await POST(makeReq({ moduleId: "m1", topicId: "t1" }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { essayPrompt?: string };
    expect(json.essayPrompt).toBeTruthy();
    expect(mod.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { essayPrompt: json.essayPrompt },
    });
  });
});
