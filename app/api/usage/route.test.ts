import { describe, expect, it, vi, beforeEach } from "vitest";

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

beforeEach(() => {
  groupBy.mockReset();
  getBudgetStatus.mockReset();
});

describe("GET /api/usage", () => {
  it("keeps the existing per-kind rollup shape and adds a budget object", async () => {
    groupBy.mockResolvedValue([
      { kind: "synthesize", _count: { _all: 2 }, _sum: { tokensIn: 10, tokensOut: 20, estimatedCost: 0.05 } },
    ]);
    getBudgetStatus.mockResolvedValue({
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
    });

    const res = await GET();
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
      dailyLimit: 0,
      monthlyLimit: 20.0,
      spentToday: 0,
      spentThisMonth: 0,
      remainingToday: 0,
      remainingThisMonth: 20.0,
      blocked: true,
      blockedReason: "daily_zero",
      dayResetsAt: new Date("2026-08-23T17:00:00Z").toISOString(),
      monthResetsAt: new Date("2026-09-01T17:00:00Z").toISOString(),
      timezone: "Asia/Jakarta",
      currency: "USD",
    });
    const res = await GET();
    const data = (await res.json()) as { budget: { blocked: boolean; blockedReason: string } };
    expect(data.budget.blocked).toBe(true);
    expect(data.budget.blockedReason).toBe("daily_zero");
  });
});
