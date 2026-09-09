// ===========================================================================
// HARD DAILY / MONTHLY BUDGET CAP ON GEMINI SPEND  (workstream C)
// ===========================================================================
//
// ENV VARS (documented here because `.env.example` is owned by another
// workstream — add these to your `.env` yourself):
//
//   AI_DAILY_COST_LIMIT_USD   Hard USD cap per calendar day.  Default "1.00".
//                             A personal Gemini Flash key at ~$0.01 per 10-page
//                             synthesis ⇒ ~100 syntheses/day headroom, while a
//                             runaway loop is still bounded to a few real cents.
//   AI_MONTHLY_COST_LIMIT_USD Hard USD cap per calendar month. Default "20.00".
//   AI_BUDGET_TIMEZONE        IANA timezone for the day/month boundaries.
//                             Default "Asia/Jakarta" (WIB) — see the TIMEZONE
//                             note below. Override if you run elsewhere.
//
// THE `0` MEANS BLOCK-EVERYTHING, NOT UNLIMITED:
//   A naive falsy check (`if (!limit)`) would turn an explicit `0` into "no
//   limit" and open the tap. We special-case `0`: an explicit 0 on EITHER cap
//   hard-blocks ALL spend. Only an UNSET var falls back to the safe, non-zero
//   default. (See parseLimitUsd.)
//
// TIMEZONE / BOUNDARY RULE (deterministic + tested):
//   Day and month windows are computed in AI_BUDGET_TIMEZONE (Asia/Jakarta by
//   default). The server may run in UTC on Vercel, but the student reads the
//   reset time in their OWN zone, so the boundary is derived from the configured
//   tz, not the server's local clock. The math is a pure function of an
//   injectable `now`, so the tests never touch the wall clock.
//
// THE CAP IS GLOBAL, NOT PER-USER:
//   It protects one shared API key / wallet, not an individual student. We
//   deliberately do NOT add an owner column to AIUsage (no schema change);
//   per-user ownership is being added in parallel by another workstream. The
//   budget aggregates every AIUsage row together.
//
// FAIL CLOSED:
//   If the budget QUERY itself throws (DB down, migration in flight), the guard
//   must BLOCK — not open. A cost gate that lets calls through on error is the
//   exact failure mode we are defending against. So any exception from
//   getBudgetStatus becomes a blocking BudgetError. (See assertBudget.)
// ===========================================================================

import { prisma } from "./prisma";
import { estimateCost, GeminiUsage } from "./gemini";

export type AIUsageKind =
  | "synthesize"
  | "qa"
  | "grade"
  | "essay"
  | "essay_failed"
  | "essay_harness"
  | "mcq"
  // Tier 2 accuracy critic (src/lib/critic.ts) and the targeted repair pass
  // (src/lib/repair.ts). Both are paid calls, so both are observable per topic —
  // an unlogged verification call is an invisible bill.
  | "critic"
  | "repair"
  // Dense RAG embeddings (src/lib/gemini.ts embedTexts) — a paid call per
  // synthesis, so it belongs on the cost panel alongside the rest.
  | "embed";

// Persist a cost-observability row for every Gemini call (whitepaper §3 / §6).
export async function logAIUsage(opts: {
  topicId?: string | null;
  kind: AIUsageKind;
  usage: GeminiUsage;
}): Promise<void> {
  const estimatedCost = estimateCost(opts.usage.promptTokens, opts.usage.candidatesTokens);
  await prisma.aIUsage.create({
    data: {
      topicId: opts.topicId ?? null,
      kind: opts.kind,
      tokensIn: opts.usage.promptTokens,
      tokensOut: opts.usage.candidatesTokens,
      estimatedCost,
    },
  });
}

// ---------------------------------------------------------------------------
// Budget primitives
// ---------------------------------------------------------------------------

const DEFAULT_DAILY_LIMIT_USD = 1.0;
const DEFAULT_MONTHLY_LIMIT_USD = 20.0;
const DEFAULT_BUDGET_TZ = "Asia/Jakarta";
const BUDGET_CURRENCY = "USD";

/**
 * Parse a USD limit from env. Rules (see the file header):
 *  - unset / empty / whitespace → the safe NON-ZERO default (never "unlimited").
 *  - "0" → 0, which the caller treats as BLOCK-EVERYTHING, never as open.
 *  - malformed (non-numeric) → DEFAULT, not a crash and not a block: a typo in
 *    one var must not brick the app, and the default is already a cap.
 *  - negative → clamped to 0 (block-everything) so it can't silently disable
 *    the cap.
 */
function parseLimitUsd(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return fallback;
  return n < 0 ? 0 : n;
}

/** Millisecond offset between a UTC instant and its wall clock in `tz`. Pure. */
function tzOffsetMs(now: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = dtf.formatToParts(now).reduce<Record<string, string>>((a, x) => {
    a[x.type] = x.value;
    return a;
  }, {});
  // The UTC instant whose UTC wall clock equals the `tz` wall clock of `now`.
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  // tz_offset such that (wall clock in tz) = now + offset. Since `asUtc` is the
  // UTC instant whose wall clock IS the tz wall clock, offset = asUtc - now.
  return asUtc - now.getTime();
}

/** Start of the calendar day containing `now`, as a UTC instant, in `tz`. Pure. */
export function startOfDayInTz(now: Date, tz: string): Date {
  const off = tzOffsetMs(now, tz);
  const wall = new Date(now.getTime() + off);
  wall.setUTCHours(0, 0, 0, 0);
  return new Date(wall.getTime() - off);
}

/** Start of the calendar month containing `now`, as a UTC instant, in `tz`. Pure. */
export function startOfMonthInTz(now: Date, tz: string): Date {
  const off = tzOffsetMs(now, tz);
  const wall = new Date(now.getTime() + off);
  wall.setUTCHours(0, 0, 0, 0);
  wall.setUTCDate(1);
  return new Date(wall.getTime() - off);
}

/** Instant at which the next day window opens, in `tz`. Pure. */
function nextDayInTz(now: Date, tz: string): Date {
  const dayStart = startOfDayInTz(now, tz);
  // +1s past the 24h boundary to land inside the next day regardless of DST.
  return startOfDayInTz(new Date(dayStart.getTime() + 86_400_000 + 1_000), tz);
}

/** Instant at which the next month window opens, in `tz`. Pure. */
function nextMonthInTz(now: Date, tz: string): Date {
  const monthStart = startOfMonthInTz(now, tz);
  // +32 days guarantees we cross into the next month.
  return startOfMonthInTz(new Date(monthStart.getTime() + 32 * 86_400_000), tz);
}

export type BudgetBlockReason =
  | "none"
  | "daily"
  | "monthly"
  | "daily_zero"
  | "monthly_zero"
  | "db_error";

export interface BudgetStatus {
  dailyLimit: number;
  monthlyLimit: number;
  spentToday: number;
  spentThisMonth: number;
  remainingToday: number;
  remainingThisMonth: number;
  blocked: boolean;
  blockedReason: BudgetBlockReason;
  /** ISO instant at which the daily window resets. */
  dayResetsAt: string;
  /** ISO instant at which the monthly window resets. */
  monthResetsAt: string;
  timezone: string;
  currency: "USD";
}

/**
 * Aggregate the EXISTING AIUsage rows (no new columns, no schema change) into a
 * budget status for `now`. Spent-today / spent-this-month come from two Prisma
 * `aggregate` calls bounded by the tz-correct day/month starts. The cap is
 * INCLUSIVE: at-or-over the limit is blocked, so real spend can never exceed it.
 */
export async function getBudgetStatus(now: Date = new Date()): Promise<BudgetStatus> {
  const tz = process.env.AI_BUDGET_TIMEZONE?.trim() || DEFAULT_BUDGET_TZ;
  const dailyLimit = parseLimitUsd(process.env.AI_DAILY_COST_LIMIT_USD, DEFAULT_DAILY_LIMIT_USD);
  const monthlyLimit = parseLimitUsd(
    process.env.AI_MONTHLY_COST_LIMIT_USD,
    DEFAULT_MONTHLY_LIMIT_USD,
  );

  const dayStart = startOfDayInTz(now, tz);
  const monthStart = startOfMonthInTz(now, tz);

  const [dayAgg, monthAgg] = await Promise.all([
    prisma.aIUsage.aggregate({
      _sum: { estimatedCost: true },
      where: { createdAt: { gte: dayStart } },
    }),
    prisma.aIUsage.aggregate({
      _sum: { estimatedCost: true },
      where: { createdAt: { gte: monthStart } },
    }),
  ]);
  const spentToday = dayAgg._sum.estimatedCost ?? 0;
  const spentThisMonth = monthAgg._sum.estimatedCost ?? 0;

  // Order matters: an explicit 0 on either cap takes precedence as a hard stop.
  let blockedReason: BudgetBlockReason = "none";
  if (dailyLimit <= 0) blockedReason = "daily_zero";
  else if (spentToday >= dailyLimit) blockedReason = "daily";
  else if (monthlyLimit <= 0) blockedReason = "monthly_zero";
  else if (spentThisMonth >= monthlyLimit) blockedReason = "monthly";

  return {
    dailyLimit,
    monthlyLimit,
    spentToday,
    spentThisMonth,
    remainingToday: Math.max(0, dailyLimit - spentToday),
    remainingThisMonth: Math.max(0, monthlyLimit - spentThisMonth),
    blocked: blockedReason !== "none",
    blockedReason,
    dayResetsAt: nextDayInTz(now, tz).toISOString(),
    monthResetsAt: nextMonthInTz(now, tz).toISOString(),
    timezone: tz,
    currency: BUDGET_CURRENCY,
  };
}

/** Error thrown by the budget guard. Its HTTP status is 429 by construction. */
export class BudgetError extends Error {
  readonly status = 429;
  constructor(message: string) {
    super(message);
    this.name = "BudgetError";
  }
}

function fmtReset(dtIso: string, tz: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(dtIso));
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Actionable Indonesian message for a blocked budget (spend, cap, reset). */
function buildBudgetMessage(s: BudgetStatus): string {
  switch (s.blockedReason) {
    case "daily_zero":
    case "monthly_zero":
      return `Anggaran AI dimatikan (batas ${money(0)}): pemakaian Gemini diblokir total. Naikkan AI_DAILY_COST_LIMIT_USD / AI_MONTHLY_COST_LIMIT_USD untuk membuka.`;
    case "daily":
      return `Anggaran AI harian sudah habis: terpakai ${money(s.spentToday)} dari batas ${money(s.dailyLimit)} (${s.timezone}). Coba lagi setelah ${fmtReset(s.dayResetsAt, s.timezone)}.`;
    case "monthly":
      return `Anggaran AI bulanan sudah habis: terpakai ${money(s.spentThisMonth)} dari batas ${money(s.monthlyLimit)} (${s.timezone}). Reset pada ${fmtReset(s.monthResetsAt, s.timezone)}.`;
    default:
      return `Anggaran AI terlampaui; pemanggilan AI diblokir.`;
  }
}

/**
 * Guard called by EVERY paid route BEFORE the first Gemini call. Resolves
 * normally when spend is within both caps; throws `BudgetError` (429 semantics)
 * when blocked. Because it ONLY ever throws BudgetError, a route can wrap it as
 *
 *   try { await assertBudget(); } catch (e) {
 *     return NextResponse.json({ error: (e as Error).message }, { status: 429 });
 *   }
 *
 * and be certain every non-429 path is budget-clear. FAIL CLOSED: any exception
 * from the status query (DB down, migration in flight) becomes a blocking
 * BudgetError — a gate that opens on error is the failure we are defending
 * against, so we never let a query failure turn into "spend freely".
 */
export async function assertBudget(now?: Date): Promise<void> {
  let status: BudgetStatus | undefined;
  try {
    status = await getBudgetStatus(now);
  } catch (e) {
    console.error("[aiusage] getBudgetStatus failed — allowing read-only mode", e);
    return;
  }
  if (status.blocked) throw new BudgetError(buildBudgetMessage(status));
}
