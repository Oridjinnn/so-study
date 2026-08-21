// Persistence + orchestration boundary for the two-tier accuracy verification.
//
// The tiers themselves are pure (src/lib/tier1.ts, src/lib/critic.ts) and the
// gauge is pure (src/lib/gauge.ts). This module owns the two things that are
// neither: (1) running tier 1 then tier 2 in the right order with the right cost
// bounds, and (2) reading back JSON that was written by a PREVIOUS version of
// this code. Stored reports are validated with zod on the way in — a module
// verified before a shape change must degrade to "belum diperiksa", never crash
// the reader and never be mistaken for a clean result.

import { z } from "zod";
import {
  collectCitedClaims,
  criticFlags,
  mergeCriticReports,
  pruneCriticReport,
  runCritic,
  type CriticClaim,
  type CriticGenerateFn,
  type CriticReport,
} from "./critic";
import { computeGauge, type GaugeResult } from "./gauge";
import {
  applyRepairs,
  buildRepairPrompt,
  collectRepairItems,
  parseRepairResponse,
  REPAIR_RESPONSE_SCHEMA,
  type RepairItem,
} from "./repair";
import { verifyTier1, type Tier1Module, type Tier1Report, type Tier1Source } from "./tier1";

const Tier1FindingSchema = z.object({
  check: z.enum(["citation_exists", "uncited_claim_ratio", "entity_grounding"]),
  severity: z.enum(["fail", "warn"]),
  claimText: z.string(),
  n: z.number().nullable(),
  citedPaperId: z.string().nullable(),
  reason: z.string(),
});

const Tier1ReportSchema = z.object({
  passed: z.boolean(),
  blocked: z.boolean(),
  citations: z.object({ total: z.number(), valid: z.number(), phantom: z.number() }),
  claims: z.object({
    total: z.number(),
    uncited: z.number(),
    ratio: z.number(),
    threshold: z.number(),
    overThreshold: z.boolean(),
  }),
  entities: z.object({ checked: z.number(), mismatched: z.number() }),
  findings: z.array(Tier1FindingSchema),
});

const CriticReportSchema = z.object({
  ran: z.boolean(),
  error: z.string().optional(),
  batches: z.number(),
  submitted: z.number(),
  judged: z.number(),
  judgments: z.array(
    z.object({
      claimText: z.string(),
      citedPaperId: z.string(),
      verdict: z.enum(["supported", "uncertain", "contradicted"]),
      note: z.string(),
      claimIndex: z.number().nullable(),
    }),
  ),
  counts: z.object({
    supported: z.number(),
    uncertain: z.number(),
    contradicted: z.number(),
  }),
  // Literal false: a stored report claiming it can block is not a report we
  // wrote, and it must not be trusted.
  blocks: z.literal(false),
});

function parseJson<T>(raw: string | null | undefined, schema: z.ZodType<T>): T | null {
  if (!raw) return null;
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    // Unreadable/stale cache → "not verified", never "verified and fine".
    return null;
  }
}

export function parseTier1Report(raw: string | null | undefined): Tier1Report | null {
  return parseJson(raw, Tier1ReportSchema) as Tier1Report | null;
}

export function parseCriticReport(raw: string | null | undefined): CriticReport | null {
  return parseJson(raw, CriticReportSchema) as CriticReport | null;
}

/** The verification payload the UI reads (one object, gauge included). */
export interface VerificationPayload {
  tier1: Tier1Report | null;
  critic: CriticReport | null;
  gauge: GaugeResult | null;
  verifiedAt: string | null;
  repairAttempts: number;
}

/** Build the client payload from stored columns; `gauge` is null until Tier 1
 * has run, because a needle with no Tier 1 evidence behind it would be fiction. */
export function verificationPayload(row: {
  verifyReport?: string | null;
  criticReport?: string | null;
  verifiedAt?: Date | string | null;
  repairAttempts?: number | null;
}): VerificationPayload {
  const tier1 = parseTier1Report(row.verifyReport);
  const critic = parseCriticReport(row.criticReport);
  return {
    tier1,
    critic,
    gauge: tier1 ? computeGauge(tier1, critic) : null,
    verifiedAt: row.verifiedAt
      ? row.verifiedAt instanceof Date
        ? row.verifiedAt.toISOString()
        : String(row.verifiedAt)
      : null,
    repairAttempts: row.repairAttempts ?? 0,
  };
}

export interface RunVerificationResult {
  tier1: Tier1Report;
  critic: CriticReport | null;
  gauge: GaugeResult;
}

/**
 * Run Tier 1 always (free, deterministic) and Tier 2 only when asked.
 *
 * Tier 2 is a paid call, so `tier2` is an explicit decision by the caller — once
 * per module at synthesis completion, and after a repair pass for the touched
 * claims. A Tier 2 failure is recorded inside its own report and never
 * propagates: Tier 1's verdict, which is the actual gate, must not depend on
 * whether a second model call succeeded.
 */
export async function runVerification(
  module: Tier1Module,
  sources: Tier1Source[],
  opts: {
    tier2: boolean;
    generate?: CriticGenerateFn;
    onUsage?: (usage: { promptTokens: number; candidatesTokens: number }) => void | Promise<void>;
  },
): Promise<RunVerificationResult> {
  const tier1 = verifyTier1(module, sources);
  let critic: CriticReport | null = null;
  if (opts.tier2 && opts.generate) {
    const claims = collectCitedClaims(module, sources);
    critic = await runCritic(claims, opts.generate, { onUsage: opts.onUsage });
  }
  return { tier1, critic, gauge: computeGauge(tier1, critic) };
}

// ---------------------------------------------------------------------------
// PART 4 — bounded, targeted regeneration
// ---------------------------------------------------------------------------

export interface TargetedRepairArgs {
  markdown: string;
  /** Citation order for the module (`[1]` → sourcePaperIds[0]). */
  sourcePaperIds: string[];
  /** Approved papers only (src/lib/moduleSources.ts guarantees this). */
  sources: Tier1Source[];
  /** Current Tier 1 report — the WARN/FAIL items the fix is built FROM. */
  tier1: Tier1Report;
  /** Cached Tier 2 report, if any — its non-supported verdicts are also fixed. */
  critic: CriticReport | null;
  /** Gemini call; JSON mode fields are passed through. */
  generate: CriticGenerateFn;
  /** System prompt from `buildRepairSystem` (course/major framing preserved). */
  system: string;
  /** Remaining attempts in the 2-attempt budget for this module. */
  maxPasses: number;
  onUsage?: (usage: { promptTokens: number; candidatesTokens: number }) => void | Promise<void>;
}

export interface TargetedRepairResult {
  markdown: string;
  /** Gemini repair calls actually spent (never more than `maxPasses`). */
  passes: number;
  appliedRevisions: number;
  tier1: Tier1Report;
  critic: CriticReport | null;
  gauge: GaugeResult;
  /** Flags still standing after the bounded passes. */
  remainingItems: RepairItem[];
  /**
   * True when flags remain AND the budget is spent: the UI must then say
   * "belum bisa diperbaiki otomatis, tinjau manual" instead of offering another
   * pass. Honest dead end beats an infinite loop.
   */
  manualReviewNeeded: boolean;
}

/**
 * Claims a repair pass actually touched — the ONLY ones Tier 2 re-judges.
 *
 * Re-running the critic over the whole module after a one-sentence edit is the
 * exact cost mistake Part 2 forbids, so we re-derive cited claims from the NEW
 * text and keep only those that live inside a replacement sentence.
 */
function touchedClaims(
  markdown: string,
  sourcePaperIds: string[],
  sources: Tier1Source[],
  revisedTexts: string[],
): CriticClaim[] {
  if (revisedTexts.length === 0) return [];
  const all = collectCitedClaims({ contentMarkdown: markdown, sourcePaperIds }, sources, 200);
  return all.filter((c) => revisedTexts.some((t) => t.includes(c.claimText)));
}

/**
 * Run at most `maxPasses` targeted repair passes.
 *
 * Each pass: build the prompt from the CURRENT flags (exact claim text + reason +
 * the cited paper's real content), apply the returned per-claim revisions in
 * place, re-run Tier 1 (free) on the whole module, re-run Tier 2 only for the
 * claims this pass rewrote, then re-derive the flag list. Stops early when the
 * flags are gone or when a pass changed nothing — a pass that applies zero
 * revisions will not do better on a second identical try, and paying for it twice
 * is waste, not persistence.
 *
 * Caller contract: only call this when `collectRepairItems` is non-empty. A clean
 * module must not trigger a paid no-op (Part 4 rule 2).
 */
export async function runTargetedRepair(
  args: TargetedRepairArgs,
): Promise<TargetedRepairResult> {
  let markdown = args.markdown;
  let tier1 = args.tier1;
  let critic = args.critic;
  let passes = 0;
  let appliedRevisions = 0;
  let items = collectRepairItems(tier1.findings, criticFlags(critic), args.sources);

  while (items.length > 0 && passes < args.maxPasses) {
    let out: { text: string; usage?: { promptTokens: number; candidatesTokens: number } };
    try {
      out = await args.generate({
        system: args.system,
        prompt: buildRepairPrompt(items),
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        responseSchema: REPAIR_RESPONSE_SCHEMA,
      });
    } catch {
      // The call failed: stop and report what still stands. Never retry blindly.
      break;
    }
    passes += 1;
    if (args.onUsage && out.usage) await args.onUsage(out.usage);

    const revisions = parseRepairResponse(out.text, items);
    const applied = applyRepairs(markdown, revisions);
    if (applied.applied === 0) break;

    markdown = applied.markdown;
    appliedRevisions += applied.applied;

    // Tier 1 re-runs in full after every pass — it is free and it is the gate.
    tier1 = verifyTier1({ contentMarkdown: markdown, sourcePaperIds: args.sourcePaperIds }, args.sources);

    // Tier 2 re-runs ONLY over the rewritten claims; verdicts about sentences
    // that no longer exist are pruned rather than left to haunt the gauge.
    const touched = touchedClaims(
      markdown,
      args.sourcePaperIds,
      args.sources,
      applied.revisedTexts,
    );
    if (touched.length > 0) {
      const fresh = await runCritic(touched, args.generate, { onUsage: args.onUsage });
      critic = mergeCriticReports(critic, fresh, applied.staleClaimTexts);
    } else {
      critic = pruneCriticReport(critic, applied.staleClaimTexts);
    }

    items = collectRepairItems(tier1.findings, criticFlags(critic), args.sources);
  }

  return {
    markdown,
    passes,
    appliedRevisions,
    tier1,
    critic,
    gauge: computeGauge(tier1, critic),
    remainingItems: items,
    manualReviewNeeded: items.length > 0,
  };
}

/** The flag list a module currently has, without spending anything. Used by the
 * UI/route to decide between "offer a targeted fix" and "already passed". */
export function pendingRepairItems(
  tier1: Tier1Report | null,
  critic: CriticReport | null,
  sources: Tier1Source[],
): RepairItem[] {
  if (!tier1) return [];
  return collectRepairItems(tier1.findings, criticFlags(critic), sources);
}
