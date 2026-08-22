/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { verifyTier1 } from "@/src/lib/tier1";
import { runVerification, runTargetedRepair } from "@/src/lib/verification";
import { loadModuleForVerification } from "@/src/lib/moduleSources";
import { assertBudget } from "@/src/lib/aiusage";
import { POST as verifyPOST } from "./route";
import { POST as repairPOST } from "../repair/route";
import type { LoadedModule } from "@/src/lib/moduleSources";
import { prisma } from "@/src/lib/prisma";

vi.mock("@/src/lib/moduleSources", () => ({
  loadModuleForVerification: vi.fn(),
}));

vi.mock("@/src/lib/aiusage", () => ({
  logAIUsage: vi.fn(async () => {}),
  // Cost guard: passes by default so the paid Tier-2 path stays testable.
  assertBudget: vi.fn(async () => {}),
}));

vi.mock("@/src/lib/verification", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    runVerification: vi.fn(),
    runTargetedRepair: vi.fn(),
  };
});

function loaded(over: Partial<LoadedModule> = {}): LoadedModule {
  return {
    id: "m1",
    topicId: "t1",
    topicTitle: "Teori Sosial",
    courseName: "Sosiologi", major: "Sosiologi",
    contentMarkdown: "Realitas sosial adalah eksternalisasi [1].",
    paperIds: ["p1"], sources: [{ id: "p1", title: "t", text: "Berger and Luckmann" }],
    verifyReport: null, criticReport: null, repairAttempts: 0,
    ...over,
  };
}

describe("/api/modules/:id/verify", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404s when the module is unknown", async () => {
    vi.mocked(loadModuleForVerification).mockResolvedValue(null);
    const res = await verifyPOST(
      new Request("http://localhost/x", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(res.status).toBe(404);
  });

  it("runs Tier 1 only by default and persists the report", async () => {
    vi.mocked(loadModuleForVerification).mockResolvedValue(loaded());
    const updateCapture: any = {};
    (vi.spyOn(prisma.module, "update") as any).mockImplementation((a: any) => { updateCapture.data = a.data; return Promise.resolve({} as any); });
    (runVerification as any).mockResolvedValue({
      tier1: { blocked: false, findings: [] },
      critic: null,
      gauge: { band: "baik", score: 1, blocked: false, flagCount: 0, breakdown: {}, breakdownLines: [], caveat: "c" },
    });

    const res = await verifyPOST(
      new Request("http://localhost/x", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: "m1" }) },
    );
    expect(res.status).toBe(200);
    expect(runVerification).toHaveBeenCalledWith(
      expect.objectContaining({ contentMarkdown: "Realitas sosial adalah eksternalisasi [1]." }),
      expect.any(Array),
      expect.objectContaining({ tier2: false }),
    );
    expect(updateCapture.data.verifyReport).not.toBeNull();
    expect(updateCapture.data.verifiedAt).toBeInstanceOf(Date);
  });

  it("adds a paid Tier 2 pass when asked", async () => {
    vi.mocked(loadModuleForVerification).mockResolvedValue(loaded());
    vi.spyOn(prisma.module, "update").mockResolvedValue({} as any);
    (runVerification as any).mockResolvedValue({
      tier1: { blocked: false, findings: [] },
      critic: { ran: true, judgments: [], counts: { supported: 1, uncertain: 0, contradicted: 0 }, blocks: false },
      gauge: { band: "baik", score: 1, blocked: false, flagCount: 0, breakdown: {}, breakdownLines: [], caveat: "c" },
    });
    const res = await verifyPOST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ tier2: true }) }),
      { params: Promise.resolve({ id: "m1" }) },
    );
    expect(res.status).toBe(200);
    expect((runVerification as any).mock.calls[0][2].tier2).toBe(true);
    const json = await res.json();
    expect(json.tier2Ran).toBe(true);
  });

  it("returns 429 (no Gemini spend) when the budget is blocked", async () => {
    const budget = assertBudget as unknown as ReturnType<typeof vi.fn>;
    budget.mockRejectedValueOnce(new Error("Anggaran AI harian sudah habis: ..."));
    vi.mocked(loadModuleForVerification).mockResolvedValue(loaded());
    const res = await verifyPOST(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ tier2: true }) }),
      { params: Promise.resolve({ id: "m1" }) },
    );
    expect(res.status).toBe(429);
    expect(runVerification).not.toHaveBeenCalled();
    const json = (await res.json()) as { error: string };
    expect(json.error.toLowerCase()).toContain("anggaran");
  });
});

describe("/api/modules/:id/repair", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404s when the module is unknown", async () => {
    vi.mocked(loadModuleForVerification).mockResolvedValue(null);
    const res = await repairPOST(
      new Request("http://localhost/x", { method: "POST" }),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns noop when there is nothing to fix", async () => {
    const tier1 = verifyTier1({ contentMarkdown: "Habitus adalah disposisi [2].", sourcePaperIds: ["p1", "p2"] }, [
      { id: "p1", title: "t", text: "Bourdieu develops habitus" }, { id: "p2", title: "t", text: "teks" },
    ]);
    vi.mocked(loadModuleForVerification).mockResolvedValue(
      loaded({
        contentMarkdown: "Habitus adalah disposisi [2].",
        paperIds: ["p1", "p2"],
        sources: [{ id: "p1", title: "t", text: "Bourdieu develops habitus" }, { id: "p2", title: "t", text: "teks" }],
        verifyReport: JSON.stringify(tier1),
      }),
    );
    const res = await repairPOST(
      new Request("http://localhost/x", { method: "POST" }),
      { params: Promise.resolve({ id: "m1" }) },
    );
    const json = await res.json();
    expect(json.result ?? json.noop).toBeTruthy();
    expect(json.noop).toBe(true);
    expect(runTargetedRepair).not.toHaveBeenCalled();
  });

  it("refuses when already at the attempt cap (manual review needed)", async () => {
    const tier1 = verifyTier1({ contentMarkdown: "Klaim hantu [9].", sourcePaperIds: ["p1"] }, [
      { id: "p1", title: "t", text: "teks" },
    ]);
    vi.mocked(loadModuleForVerification).mockResolvedValue(
      loaded({
        contentMarkdown: "Klaim hantu [9].", paperIds: ["p1"],
        sources: [{ id: "p1", title: "t", text: "teks" }],
        verifyReport: JSON.stringify(tier1), repairAttempts: 2,
      }),
    );
    const res = await repairPOST(
      new Request("http://localhost/x", { method: "POST" }),
      { params: Promise.resolve({ id: "m1" }) },
    );
    const json = await res.json();
    expect(json.manualReviewNeeded).toBe(true);
    expect(runTargetedRepair).not.toHaveBeenCalled();
  });

  it("persists the repaired markdown plus a new version and a repair usage row", async () => {
    const tier1 = verifyTier1({ contentMarkdown: "Klaim hantu [9].", sourcePaperIds: ["p1"] }, [
      { id: "p1", title: "t", text: "teks" },
    ]);
    vi.mocked(loadModuleForVerification).mockResolvedValue(
      loaded({
        contentMarkdown: "Klaim hantu [9].", paperIds: ["p1"],
        sources: [{ id: "p1", title: "t", text: "teks" }],
        verifyReport: JSON.stringify(tier1), repairAttempts: 0,
      }),
    );
    vi.spyOn(prisma.moduleVersion, "count").mockResolvedValue(3);
    vi.spyOn(prisma, "$transaction").mockImplementation(async (fn: any) => (Array.isArray(fn) ? fn : fn([])));
    vi.spyOn(prisma.moduleChunk, "deleteMany").mockResolvedValue({ count: 0 } as any);
    vi.spyOn(prisma.excerpt, "deleteMany").mockResolvedValue({ count: 0 } as any);
    const updateCapture: any = {};
    (vi.spyOn(prisma.module, "update") as any).mockImplementation((a: any) => { updateCapture.data = a.data; return Promise.resolve({} as any); });
    (runTargetedRepair as any).mockResolvedValue({
      passes: 1, appliedRevisions: 1, markdown: "Klaim benar [1].",
      tier1: { blocked: false, findings: [] },
      critic: { ran: true, judgments: [], counts: { supported: 1, uncertain: 0, contradicted: 0 }, blocks: false },
      staleClaimTexts: ["Klaim hantu [9]."], revisedTexts: ["Klaim benar [1]."],
      remainingItems: [], manualReviewNeeded: false,
    });

    const res = await repairPOST(
      new Request("http://localhost/x", { method: "POST" }),
      { params: Promise.resolve({ id: "m1" }) },
    );
    const json = await res.json();
    expect(json.result ?? json.changed).toBeTruthy();
    expect(json.changed).toBe(true);
    expect(updateCapture.data.contentMarkdown).toBe("Klaim benar [1].");
    expect(updateCapture.data.repairAttempts).toBe(1);
    expect(updateCapture.data.versions.create.version).toBe(4);
  });
});
