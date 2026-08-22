/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { verifyTier1 } from "@/src/lib/tier1";
import { runTargetedRepair } from "@/src/lib/verification";
import { loadModuleForVerification } from "@/src/lib/moduleSources";
import { assertBudget } from "@/src/lib/aiusage";
import { POST as repairPOST } from "./route";
import type { LoadedModule } from "@/src/lib/moduleSources";
import { prisma } from "@/src/lib/prisma";
import { OTHER_USER_ID, TEST_USER_ID, sessionCookie } from "@/src/lib/testAuth";

// Repair is the most destructive of the module routes: it rewrites
// contentMarkdown, drops chunks/excerpts and spends Gemini calls. The behavioural
// suites (noop / attempt cap / persistence) used to live next door in
// verify/route.test.ts; they belong here, alongside the tenancy assertions for
// the same handler.

vi.mock("@/src/lib/moduleSources", () => ({
  loadModuleForVerification: vi.fn(),
}));

vi.mock("@/src/lib/aiusage", () => ({
  logAIUsage: vi.fn(async () => {}),
  assertBudget: vi.fn(async () => {}),
}));

vi.mock("@/src/lib/verification", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, runTargetedRepair: vi.fn() };
});

const MODULE_ID = "m1";

// The owner probe in front of the (id-only) shared loader, as a fake table: the
// row exists only for its owner, so a route that dropped `ownerId` from the WHERE
// clause fails these tests instead of quietly repairing someone else's module.
const moduleFindFirst = vi.spyOn(prisma.module, "findFirst");
const moduleUpdate = vi.spyOn(prisma.module, "update");

function loaded(over: Partial<LoadedModule> = {}): LoadedModule {
  return {
    id: MODULE_ID,
    topicId: "t1",
    topicTitle: "Teori Sosial",
    courseName: "Sosiologi", major: "Sosiologi",
    contentMarkdown: "Realitas sosial adalah eksternalisasi [1].",
    paperIds: ["p1"], sources: [{ id: "p1", title: "t", text: "Berger and Luckmann" }],
    verifyReport: null, criticReport: null, repairAttempts: 0,
    ...over,
  };
}

async function authedReq(userId: string = TEST_USER_ID): Promise<Request> {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { cookie: await sessionCookie(userId) },
  });
}

function anonReq(): Request {
  return new Request("http://localhost/x", { method: "POST" });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** A module with one phantom citation — i.e. something for repair to fix. */
function flaggedModule() {
  const tier1 = verifyTier1({ contentMarkdown: "Klaim hantu [9].", sourcePaperIds: ["p1"] }, [
    { id: "p1", title: "t", text: "teks" },
  ]);
  return loaded({
    contentMarkdown: "Klaim hantu [9].",
    paperIds: ["p1"],
    sources: [{ id: "p1", title: "t", text: "teks" }],
    verifyReport: JSON.stringify(tier1),
  });
}

describe("/api/modules/:id/repair — tenancy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    moduleFindFirst.mockImplementation((async ({ where }: any) =>
      where.id === MODULE_ID && where.ownerId === TEST_USER_ID ? { id: MODULE_ID } : null) as any);
    moduleUpdate.mockResolvedValue({} as any);
  });

  it("401s with no session — before the budget query, the load and any repair", async () => {
    const res = await repairPOST(anonReq(), ctx(MODULE_ID));
    expect(res.status).toBe(401);
    expect(assertBudget).not.toHaveBeenCalled();
    expect(moduleFindFirst).not.toHaveBeenCalled();
    expect(loadModuleForVerification).not.toHaveBeenCalled();
    expect(runTargetedRepair).not.toHaveBeenCalled();
    expect(moduleUpdate).not.toHaveBeenCalled();
  });

  it("404s another student's module id, repairs nothing and writes nothing", async () => {
    vi.mocked(loadModuleForVerification).mockResolvedValue(flaggedModule());
    const res = await repairPOST(await authedReq(OTHER_USER_ID), ctx(MODULE_ID));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Modul tidak ditemukan." });
    expect(moduleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MODULE_ID, ownerId: OTHER_USER_ID } }),
    );
    // The flagged module was loadable, so only the owner check stands between a
    // guessed id and a rewrite of her text. Assert it held.
    expect(loadModuleForVerification).not.toHaveBeenCalled();
    expect(runTargetedRepair).not.toHaveBeenCalled();
    expect(moduleUpdate).not.toHaveBeenCalled();
  });

  it("404s an unknown module id without reaching the shared loader", async () => {
    const res = await repairPOST(await authedReq(), ctx("nope"));
    expect(res.status).toBe(404);
    expect(loadModuleForVerification).not.toHaveBeenCalled();
  });

  it("returns 429 (no Gemini spend) when the budget is blocked", async () => {
    (assertBudget as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Anggaran AI harian sudah habis: ..."),
    );
    vi.mocked(loadModuleForVerification).mockResolvedValue(flaggedModule());
    const res = await repairPOST(await authedReq(), ctx(MODULE_ID));
    expect(res.status).toBe(429);
    expect(runTargetedRepair).not.toHaveBeenCalled();
  });
});

describe("/api/modules/:id/repair — behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    moduleFindFirst.mockImplementation((async ({ where }: any) =>
      where.id === MODULE_ID && where.ownerId === TEST_USER_ID ? { id: MODULE_ID } : null) as any);
    moduleUpdate.mockResolvedValue({} as any);
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
    const res = await repairPOST(await authedReq(), ctx(MODULE_ID));
    const json = await res.json();
    expect(json.result ?? json.noop).toBeTruthy();
    expect(json.noop).toBe(true);
    expect(runTargetedRepair).not.toHaveBeenCalled();
  });

  it("refuses when already at the attempt cap (manual review needed)", async () => {
    vi.mocked(loadModuleForVerification).mockResolvedValue(
      loaded({ ...flaggedModule(), repairAttempts: 2 }),
    );
    const res = await repairPOST(await authedReq(), ctx(MODULE_ID));
    const json = await res.json();
    expect(json.manualReviewNeeded).toBe(true);
    expect(runTargetedRepair).not.toHaveBeenCalled();
  });

  it("persists the repaired markdown plus a new version, all owner-scoped", async () => {
    vi.mocked(loadModuleForVerification).mockResolvedValue(flaggedModule());
    const versionCount = vi.spyOn(prisma.moduleVersion, "count").mockResolvedValue(3);
    vi.spyOn(prisma, "$transaction").mockImplementation(async (fn: any) => (Array.isArray(fn) ? fn : fn([])));
    const chunkDelete = vi
      .spyOn(prisma.moduleChunk, "deleteMany")
      .mockResolvedValue({ count: 0 } as any);
    const excerptDelete = vi
      .spyOn(prisma.excerpt, "deleteMany")
      .mockResolvedValue({ count: 0 } as any);
    const updateCapture: any = {};
    moduleUpdate.mockImplementation(((a: any) => {
      updateCapture.where = a.where;
      updateCapture.data = a.data;
      return Promise.resolve({} as any);
    }) as any);
    (runTargetedRepair as any).mockResolvedValue({
      passes: 1, appliedRevisions: 1, markdown: "Klaim benar [1].",
      tier1: { blocked: false, findings: [] },
      critic: { ran: true, judgments: [], counts: { supported: 1, uncertain: 0, contradicted: 0 }, blocks: false },
      staleClaimTexts: ["Klaim hantu [9]."], revisedTexts: ["Klaim benar [1]."],
      remainingItems: [], manualReviewNeeded: false,
    });

    const res = await repairPOST(await authedReq(), ctx(MODULE_ID));
    const json = await res.json();
    expect(json.result ?? json.changed).toBeTruthy();
    expect(json.changed).toBe(true);
    expect(updateCapture.data.contentMarkdown).toBe("Klaim benar [1].");
    expect(updateCapture.data.repairAttempts).toBe(1);
    expect(updateCapture.data.versions.create.version).toBe(4);
    // Every statement in the transaction carries the owner: the update via its own
    // WHERE, the chunk/excerpt deletes and the version count through the parent
    // module relation (those rows have no owner column of their own).
    expect(updateCapture.where).toEqual({ id: MODULE_ID, ownerId: TEST_USER_ID });
    expect(versionCount).toHaveBeenCalledWith({
      where: { moduleId: MODULE_ID, module: { ownerId: TEST_USER_ID } },
    });
    expect(chunkDelete).toHaveBeenCalledWith({
      where: { moduleId: MODULE_ID, module: { ownerId: TEST_USER_ID } },
    });
    expect(excerptDelete).toHaveBeenCalledWith({
      where: { moduleId: MODULE_ID, module: { ownerId: TEST_USER_ID } },
    });
  });
});
