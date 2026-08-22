/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runVerification } from "@/src/lib/verification";
import { loadModuleForVerification } from "@/src/lib/moduleSources";
import { assertBudget } from "@/src/lib/aiusage";
import { POST as verifyPOST } from "./route";
import type { LoadedModule } from "@/src/lib/moduleSources";
import { prisma } from "@/src/lib/prisma";
import { OTHER_USER_ID, TEST_USER_ID, sessionCookie } from "@/src/lib/testAuth";

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

/** The module in the fake database, owned by TEST_USER_ID. */
const MODULE_ID = "m1";

// The owner probe the route runs before the (id-only) shared loader. Implemented
// as a fake TABLE — it returns the row only when the WHERE clause carries the
// right owner — so these tests fail if the route ever drops `ownerId` from it.
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

/** POST carrying a REAL signed session cookie (src/lib/testAuth.ts). */
async function authedReq(body = "{}", userId: string = TEST_USER_ID): Promise<Request> {
  return new Request("http://localhost/x", {
    method: "POST",
    body,
    headers: { cookie: await sessionCookie(userId) },
  });
}

/** POST with no session at all. */
function anonReq(body = "{}"): Request {
  return new Request("http://localhost/x", { method: "POST", body });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/modules/:id/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    moduleFindFirst.mockImplementation((async ({ where }: any) =>
      where.id === MODULE_ID && where.ownerId === TEST_USER_ID ? { id: MODULE_ID } : null) as any);
    moduleUpdate.mockResolvedValue({} as any);
  });

  it("401s with no session — before the budget query and before any load", async () => {
    const res = await verifyPOST(anonReq(), ctx(MODULE_ID));
    expect(res.status).toBe(401);
    // Auth is the FIRST gate: an anonymous caller cannot probe budget state, and
    // costs neither a DB query nor a Gemini call.
    expect(assertBudget).not.toHaveBeenCalled();
    expect(moduleFindFirst).not.toHaveBeenCalled();
    expect(loadModuleForVerification).not.toHaveBeenCalled();
    expect(runVerification).not.toHaveBeenCalled();
  });

  it("404s when the module is unknown", async () => {
    const res = await verifyPOST(await authedReq(), ctx("nope"));
    expect(res.status).toBe(404);
    // The unknown id never reaches the id-only shared loader.
    expect(loadModuleForVerification).not.toHaveBeenCalled();
    expect(runVerification).not.toHaveBeenCalled();
  });

  it("404s another student's module id and never verifies (or bills for) it", async () => {
    const res = await verifyPOST(
      await authedReq(JSON.stringify({ tier2: true }), OTHER_USER_ID),
      ctx(MODULE_ID),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Modul tidak ditemukan." });
    expect(moduleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MODULE_ID, ownerId: OTHER_USER_ID } }),
    );
    // No paid Tier 2, no write: the 404 is a dead end, not a slower success.
    expect(runVerification).not.toHaveBeenCalled();
    expect(moduleUpdate).not.toHaveBeenCalled();
  });

  it("runs Tier 1 only by default and persists the report", async () => {
    vi.mocked(loadModuleForVerification).mockResolvedValue(loaded());
    const updateCapture: any = {};
    moduleUpdate.mockImplementation(((a: any) => {
      updateCapture.where = a.where;
      updateCapture.data = a.data;
      return Promise.resolve({} as any);
    }) as any);
    (runVerification as any).mockResolvedValue({
      tier1: { blocked: false, findings: [] },
      critic: null,
      gauge: { band: "baik", score: 1, blocked: false, flagCount: 0, breakdown: {}, breakdownLines: [], caveat: "c" },
    });

    const res = await verifyPOST(await authedReq(), ctx(MODULE_ID));
    expect(res.status).toBe(200);
    expect(runVerification).toHaveBeenCalledWith(
      expect.objectContaining({ contentMarkdown: "Realitas sosial adalah eksternalisasi [1]." }),
      expect.any(Array),
      expect.objectContaining({ tier2: false }),
    );
    expect(updateCapture.data.verifyReport).not.toBeNull();
    expect(updateCapture.data.verifiedAt).toBeInstanceOf(Date);
    // The WRITE is owner-scoped too, not just the read that preceded it.
    expect(updateCapture.where).toEqual({ id: MODULE_ID, ownerId: TEST_USER_ID });
  });

  it("adds a paid Tier 2 pass when asked", async () => {
    vi.mocked(loadModuleForVerification).mockResolvedValue(loaded());
    (runVerification as any).mockResolvedValue({
      tier1: { blocked: false, findings: [] },
      critic: { ran: true, judgments: [], counts: { supported: 1, uncertain: 0, contradicted: 0 }, blocks: false },
      gauge: { band: "baik", score: 1, blocked: false, flagCount: 0, breakdown: {}, breakdownLines: [], caveat: "c" },
    });
    const res = await verifyPOST(
      await authedReq(JSON.stringify({ tier2: true })),
      ctx(MODULE_ID),
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
      await authedReq(JSON.stringify({ tier2: true })),
      ctx(MODULE_ID),
    );
    expect(res.status).toBe(429);
    expect(runVerification).not.toHaveBeenCalled();
    const json = (await res.json()) as { error: string };
    expect(json.error.toLowerCase()).toContain("anggaran");
  });
});
