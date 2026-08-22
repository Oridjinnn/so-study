import { describe, expect, it, vi, beforeEach } from "vitest";

// Isolate the budget logic from the real database. We mock only the AIUsage
// aggregate; every non-aggregate behaviour (limits, tz boundaries, blocking) is
// exercised directly and deterministically via an injectable `now`.
const mocks = vi.hoisted(() => ({ agg: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({
  prisma: { aIUsage: { aggregate: mocks.agg } },
}));

import {
  getBudgetStatus,
  assertBudget,
  startOfDayInTz,
  startOfMonthInTz,
  BudgetError,
} from "./aiusage";

const agg = mocks.agg;

const TZ = "Asia/Jakarta"; // WIB, the student's zone

/** Wall-clock of `dt` in `tz`, as "YYYY-MM-DD HH:mm:ss" for assertions. */
function wall(dt: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(dt)
    .replace(", ", " ");
}

let daySpend = 0;
let monthSpend = 0;
let monthStartRef = new Date(0);

beforeEach(() => {
  // Each test owns its env; never let one leak into the next.
  delete process.env.AI_DAILY_COST_LIMIT_USD;
  delete process.env.AI_MONTHLY_COST_LIMIT_USD;
  delete process.env.AI_BUDGET_TIMEZONE;
  delete process.env.GEMINI_EMBED_MODEL;
  daySpend = 0;
  monthSpend = 0;
  monthStartRef = new Date(0);
  agg.mockReset();
  // Route the day vs month aggregate to the right spend figure by matching the
  // exact boundary instant getBudgetStatus computes (deterministic, no clock).
  agg.mockImplementation(async (opts: { where?: { createdAt?: { gte?: Date } } }) => {
    const gte = opts.where?.createdAt?.gte;
    const isMonth = gte && monthStartRef.getTime() === gte.getTime();
    return { _sum: { estimatedCost: isMonth ? monthSpend : daySpend } };
  });
});

describe("boundary helpers (startOfDayInTz / startOfMonthInTz)", () => {
  it("computes midnight in the configured tz, not the server clock", () => {
    // 2026-08-22T16:00:00Z === 2026-08-23T00:30 WIB? No: +7h => 23:00 WIB same day.
    const now = new Date("2026-08-22T16:00:00Z");
    const day = startOfDayInTz(now, TZ);
    expect(wall(day, TZ)).toBe("2026-08-22 00:00:00");
    const month = startOfMonthInTz(now, TZ);
    expect(wall(month, TZ)).toBe("2026-08-01 00:00:00");
  });

  it("rolls the day forward across the WIB midnight boundary", () => {
    // 2026-08-22T23:30:00Z === 2026-08-23T06:30 WIB (already next day).
    const now = new Date("2026-08-22T23:30:00Z");
    const day = startOfDayInTz(now, TZ);
    expect(wall(day, TZ)).toBe("2026-08-23 00:00:00");
  });

  it("rolls the month forward at a month boundary in WIB", () => {
    // 2026-08-31T17:00:00Z === 2026-09-01T00:00 WIB (first instant of Sept).
    const now = new Date("2026-08-31T17:00:00Z");
    const month = startOfMonthInTz(now, TZ);
    expect(wall(month, TZ)).toBe("2026-09-01 00:00:00");
  });

  it("honours a non-default timezone (injectable, deterministic)", () => {
    const now = new Date("2026-08-22T03:00:00Z"); // 23:00 previous day in New York (EDT, -4)
    const day = startOfDayInTz(now, "America/New_York");
    expect(wall(day, "America/New_York")).toBe("2026-08-21 00:00:00");
  });
});

describe("getBudgetStatus — limits, defaults, boundaries", () => {
  it("uses safe non-zero defaults when nothing is set", async () => {
    const now = new Date("2026-08-22T16:00:00Z");
    monthStartRef = startOfMonthInTz(now, TZ);
    const s = await getBudgetStatus(now);
    expect(s.dailyLimit).toBe(1.0);
    expect(s.monthlyLimit).toBe(20.0);
    expect(s.blocked).toBe(false);
    expect(s.blockedReason).toBe("none");
    expect(s.remainingToday).toBe(1.0);
    expect(s.remainingThisMonth).toBe(20.0);
  });

  it("treats a malformed env var as the safe default (no crash, no block)", async () => {
    process.env.AI_DAILY_COST_LIMIT_USD = "abc";
    const now = new Date("2026-08-22T16:00:00Z");
    monthStartRef = startOfMonthInTz(now, TZ);
    const s = await getBudgetStatus(now);
    // "abc" must not disable the cap nor error out.
    expect(s.dailyLimit).toBe(1.0);
    expect(s.blocked).toBe(false);
  });

  it("blocks exactly at the daily limit (cap is inclusive)", async () => {
    process.env.AI_DAILY_COST_LIMIT_USD = "1.00";
    daySpend = 1.0;
    const now = new Date("2026-08-22T16:00:00Z");
    monthStartRef = startOfMonthInTz(now, TZ);
    const s = await getBudgetStatus(now);
    expect(s.blocked).toBe(true);
    expect(s.blockedReason).toBe("daily");
    expect(s.remainingToday).toBe(0);
  });

  it("blocks one cent over the daily limit", async () => {
    process.env.AI_DAILY_COST_LIMIT_USD = "1.00";
    daySpend = 1.01;
    const now = new Date("2026-08-22T16:00:00Z");
    monthStartRef = startOfMonthInTz(now, TZ);
    const s = await getBudgetStatus(now);
    expect(s.blocked).toBe(true);
    expect(s.blockedReason).toBe("daily");
  });

  it("allows spend strictly under the limit", async () => {
    process.env.AI_DAILY_COST_LIMIT_USD = "1.00";
    daySpend = 0.5;
    const now = new Date("2026-08-22T16:00:00Z");
    monthStartRef = startOfMonthInTz(now, TZ);
    const s = await getBudgetStatus(now);
    expect(s.blocked).toBe(false);
    expect(s.remainingToday).toBe(0.5);
  });

  it("treats an explicit 0 as block-everything, not unlimited", async () => {
    process.env.AI_DAILY_COST_LIMIT_USD = "0";
    daySpend = 0; // even with zero spend, 0 must hard-block
    const now = new Date("2026-08-22T16:00:00Z");
    monthStartRef = startOfMonthInTz(now, TZ);
    const s = await getBudgetStatus(now);
    expect(s.blocked).toBe(true);
    expect(s.blockedReason).toBe("daily_zero");
  });

  it("blocks on the monthly cap even when the daily cap is fine", async () => {
    process.env.AI_DAILY_COST_LIMIT_USD = "1.00";
    process.env.AI_MONTHLY_COST_LIMIT_USD = "20.00";
    daySpend = 0.5; // under daily
    monthSpend = 21.0; // over monthly
    const now = new Date("2026-08-22T16:00:00Z");
    monthStartRef = startOfMonthInTz(now, TZ);
    const s = await getBudgetStatus(now);
    expect(s.blocked).toBe(true);
    expect(s.blockedReason).toBe("monthly");
  });
});

describe("assertBudget — guard semantics", () => {
  it("resolves when within both caps", async () => {
    const now = new Date("2026-08-22T16:00:00Z");
    monthStartRef = startOfMonthInTz(now, TZ);
    await expect(assertBudget(now)).resolves.toBeUndefined();
  });

  it("throws BudgetError (429) when blocked", async () => {
    process.env.AI_DAILY_COST_LIMIT_USD = "0";
    const now = new Date("2026-08-22T16:00:00Z");
    monthStartRef = startOfMonthInTz(now, TZ);
    await expect(assertBudget(now)).rejects.toBeInstanceOf(BudgetError);
    try {
      await assertBudget(now);
    } catch (e) {
      expect((e as BudgetError).status).toBe(429);
      expect((e as Error).message.toLowerCase()).toContain("anggaran");
    }
  });

  it("FAILS CLOSED: a DB error while reading the budget blocks, not opens", async () => {
    agg.mockRejectedValue(new Error("connection refused (migration in flight)"));
    const now = new Date("2026-08-22T16:00:00Z");
    monthStartRef = startOfMonthInTz(now, TZ);
    await expect(assertBudget(now)).rejects.toBeInstanceOf(BudgetError);
    try {
      await assertBudget(now);
    } catch (e) {
      // The message must explain the failure was the budget CHECK, not a spend.
      expect((e as Error).message.toLowerCase()).toContain("anggaran");
    }
  });
});
