import { describe, expect, it, vi, beforeEach } from "vitest";
import { anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  getBudgetStatus: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => ({
  prisma: { aIUsage: { groupBy: mocks.groupBy } },
}));
vi.mock("@/src/lib/aiusage", () => ({
  getBudgetStatus: mocks.getBudgetStatus,
}));

import { GET } from "./route";

const groupBy = mocks.groupBy;
const getBudgetStatus = mocks.getBudgetStatus;

async function authed() {
  return { headers: await authedHeaders() } as unknown as Request;
}

const BUDGET = {
  dailyLimit: 1.0,
  monthlyLimit: 20.0,
  spentToday: 0.05,
  spentThisMonth: 0.05,
  remainingToday: 0.95,
  remainingThisMonth: 19.95,
  blocked: false,
  blockedReason: "none",
  dayResetsAt: new Date("2026-08-23T17:00:00Z").toISOString(),
  monthResetsAt: new Date("2026-09-01T17:00:00Z").toISOString(),
  timezone: "Asia/Jakarta",
  currency: "USD",
};

beforeEach(() => {
  groupBy.mockReset();
  getBudgetStatus.mockReset();
});

describe("GET /api/usage", () => {
  it("keeps the existing per-kind rollup shape and adds a budget object", async () => {
    groupBy.mockResolvedValue([
      { kind: "synthesize", _count: { _all: 2 }, _sum: { tokensIn: 10, tokensOut: 20, estimatedCost: 0.05 } },
    ]);
    getBudgetStatus.mockResolvedValue(BUDGET);

    const res = await GET(await authed());
    const data = (await res.json()) as {
      usage: { kind: string; calls: number; tokensIn: number; tokensOut: number; estimatedCost: number }[];
      budget: unknown;
    };
    // Backward-compatible: the old shape is untouched (a DOM test depends on it).
    expect(data.usage).toHaveLength(1);
    expect(data.usage[0]).toEqual({
      kind: "synthesize",
      calls: 2,
      tokensIn: 10,
      tokensOut: 20,
      estimatedCost: 0.05,
    });
    // Additive: the budget object is now present.
    expect(data.budget).toBeTruthy();
    expect((data.budget as { dailyLimit: number }).dailyLimit).toBe(1.0);
  });

  it("surfaces a blocked budget in the response", async () => {
    groupBy.mockResolvedValue([]);
    getBudgetStatus.mockResolvedValue({
      ...BUDGET,
      dailyLimit: 0,
      spentToday: 0,
      spentThisMonth: 0,
      remainingToday: 0,
      remainingThisMonth: 20.0,
      blocked: true,
      blockedReason: "daily_zero",
    });
    const res = await GET(await authed());
    const data = (await res.json()) as { budget: { blocked: boolean; blockedReason: string } };
    expect(data.budget.blocked).toBe(true);
    expect(data.budget.blockedReason).toBe("daily_zero");
  });

  it("401s a request with no session cookie", async () => {
    // AIUsage stays GLOBAL on purpose (one shared key/wallet), so the tenancy
    // requirement is authentication rather than scoping — but the spend ledger is
    // still not public: no cookie, no numbers, and no aggregate query at all.
    const res = await GET({ headers: anonymousHeaders() } as unknown as Request);
    expect(res.status).toBe(401);
    expect(groupBy).not.toHaveBeenCalled();
    expect(getBudgetStatus).not.toHaveBeenCalled();
  });

  it("does NOT filter the rollup by user (both students share the cap)", async () => {
    groupBy.mockResolvedValue([]);
    getBudgetStatus.mockResolvedValue(BUDGET);
    await GET(await authed());
    // A `where` here would show each student a number that cannot explain the
    // shared 429 they get when the other one exhausts the budget.
    expect(groupBy.mock.calls[0][0]).not.toHaveProperty("where");
  });
});
