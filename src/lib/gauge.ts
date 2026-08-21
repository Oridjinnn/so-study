// Reliability gauge — the composite score, its bands, and the LABELLED
// BREAKDOWN that must travel with it.
//
// ---------------------------------------------------------------------------
// WHY THE FORMULA LIVES HERE, IN ONE PURE FUNCTION
// ---------------------------------------------------------------------------
// A single needle position with no explanation is worse than no gauge at all: it
// invites the student to read "92" as "92% true". So the number is never produced
// without the components that made it (`breakdownLines`) and without the caveat
// that says what it does and does not measure (`GAUGE_CAVEAT`). Both are part of
// the return value, not UI decoration, so no caller can render the needle while
// dropping the explanation.
//
// The score is composed of Tier 1 evidence (deterministic: valid citations,
// uncited-claim ratio, entity mismatches) and Tier 2 opinion (an AI critic's
// verdict distribution). Bands map to those same categories — FAIL, WARN, and
// verdict mix — not to an aesthetic gradient.
//
// Pure: no I/O, no dates, no randomness. Same reports in → same gauge out.

import type { CriticReport } from "./critic";
import type { Tier1Report } from "./tier1";

/** Copy that MUST be rendered next to the needle, never hidden behind a hover.
 * Overclaiming precision here is worse than shipping no gauge. */
export const GAUGE_CAVEAT =
  "Skor ini mengukur seberapa baik klaim modul terhubung ke sumbernya — bukan " +
  "jaminan semua interpretasi teoritis 100% akurat. Klaim yang ditandai masih " +
  "perlu ditinjau manusia.";

/**
 * Bands, in order of severity. Named after what they MEAN, not after a colour:
 *   - `ditahan`      — Tier 1 hard fail (phantom citation). Module is blocked.
 *   - `perlu-tinjau` — the AI critic contradicted at least one cited claim.
 *   - `cukup`        — warnings present, or Tier 2 never ran (unverified ≠ clean).
 *   - `baik`         — no findings at all AND Tier 2 ran with every claim supported.
 */
export type GaugeBand = "ditahan" | "perlu-tinjau" | "cukup" | "baik";

export interface GaugeBreakdown {
  citationsTotal: number;
  citationsValid: number;
  citationsPhantom: number;
  claimsTotal: number;
  uncitedClaims: number;
  uncitedRatio: number;
  uncitedThreshold: number;
  uncitedOverThreshold: boolean;
  entitiesChecked: number;
  entitiesMismatched: number;
  criticRan: boolean;
  criticJudged: number;
  criticSupported: number;
  criticUncertain: number;
  criticContradicted: number;
  /** uncertain + contradicted — what a human is being asked to look at. */
  aiFlagged: number;
}

export interface GaugeResult {
  /** 0..1, 4dp. A summary of `breakdownLines`, never a replacement for them. */
  score: number;
  band: GaugeBand;
  /** Tier 1's hard gate, mirrored so the UI reads one object. */
  blocked: boolean;
  breakdown: GaugeBreakdown;
  /** Human-readable components of the score, in Bahasa Indonesia. */
  breakdownLines: string[];
  /** Always `GAUGE_CAVEAT`; carried in the payload so it cannot be dropped. */
  caveat: string;
  /** Tier 1 WARN + Tier 2 non-supported count — drives the repair affordance. */
  flagCount: number;
}

// Penalty weights. Deliberately gentle: this is a "how well is this wired to its
// sources" score, and a WARN-only module must not look catastrophic, or the
// student learns to ignore the gauge (the same reasoning as grounding.ts's
// lenient thresholds).
const PENALTY_UNCITED_OVER = 0.15;
const PENALTY_PER_ENTITY = 0.02;
const PENALTY_ENTITY_CAP = 0.1;
const PENALTY_PER_UNCERTAIN = 0.03;
const PENALTY_PER_CONTRADICTED = 0.08;
const PENALTY_CRITIC_CAP = 0.3;
/** Not running the second opinion is a known unknown, not a clean bill. */
const PENALTY_CRITIC_NOT_RUN = 0.05;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function pct(ratio: number): number {
  return Math.round(ratio * 100);
}

export function computeGauge(
  tier1: Tier1Report,
  critic?: CriticReport | null,
): GaugeResult {
  const criticRan = Boolean(critic?.ran);
  const counts = critic?.counts ?? { supported: 0, uncertain: 0, contradicted: 0 };
  const aiFlagged = counts.uncertain + counts.contradicted;

  const breakdown: GaugeBreakdown = {
    citationsTotal: tier1.citations.total,
    citationsValid: tier1.citations.valid,
    citationsPhantom: tier1.citations.phantom,
    claimsTotal: tier1.claims.total,
    uncitedClaims: tier1.claims.uncited,
    uncitedRatio: tier1.claims.ratio,
    uncitedThreshold: tier1.claims.threshold,
    uncitedOverThreshold: tier1.claims.overThreshold,
    entitiesChecked: tier1.entities.checked,
    entitiesMismatched: tier1.entities.mismatched,
    criticRan,
    criticJudged: critic?.judged ?? 0,
    criticSupported: counts.supported,
    criticUncertain: counts.uncertain,
    criticContradicted: counts.contradicted,
    aiFlagged,
  };

  // Base: the share of inline citations that point at a real approved paper.
  const base = tier1.citations.total === 0 ? 1 : tier1.citations.valid / tier1.citations.total;

  const entityPenalty = Math.min(
    PENALTY_ENTITY_CAP,
    tier1.entities.mismatched * PENALTY_PER_ENTITY,
  );
  const criticPenalty = Math.min(
    PENALTY_CRITIC_CAP,
    counts.uncertain * PENALTY_PER_UNCERTAIN + counts.contradicted * PENALTY_PER_CONTRADICTED,
  );
  const penalties =
    (tier1.claims.overThreshold ? PENALTY_UNCITED_OVER : 0) +
    entityPenalty +
    criticPenalty +
    (criticRan ? 0 : PENALTY_CRITIC_NOT_RUN);

  const score = round4(Math.min(1, Math.max(0, base - penalties)));

  let band: GaugeBand;
  if (tier1.blocked) band = "ditahan";
  else if (counts.contradicted > 0) band = "perlu-tinjau";
  else if (tier1.claims.overThreshold || tier1.entities.mismatched > 0 || counts.uncertain > 0) {
    band = "cukup";
  } else if (!criticRan) {
    // No second opinion yet: the top band would claim more than we checked.
    band = "cukup";
  } else band = "baik";

  const lines: string[] = [
    `Sitasi valid: ${tier1.citations.valid}/${tier1.citations.total}` +
      (tier1.citations.phantom > 0
        ? ` · ${tier1.citations.phantom} sitasi hantu (menahan modul)`
        : ""),
    `Klaim tanpa sitasi: ${tier1.claims.uncited} dari ${tier1.claims.total}` +
      (tier1.claims.total > 0
        ? ` (${pct(tier1.claims.ratio)}%, ambang ${pct(tier1.claims.threshold)}%) — ` +
          (tier1.claims.overThreshold ? "di atas ambang" : "di bawah ambang")
        : ""),
    `Nama/angka dekat sitasi yang tidak ditemukan di sumber: ${tier1.entities.mismatched} dari ${tier1.entities.checked} diperiksa`,
    criticRan
      ? `Ditandai AI untuk ditinjau: ${aiFlagged} dari ${breakdown.criticJudged} klaim dinilai ` +
        `(${counts.contradicted} kontradiksi, ${counts.uncertain} tidak pasti, ${counts.supported} didukung)`
      : "Tinjauan AI (Tahap 2): belum dijalankan — skor belum memuat opini kedua",
  ];
  if (critic?.error) lines.push(`Catatan tinjauan AI: ${critic.error}`);

  return {
    score,
    band,
    blocked: tier1.blocked,
    breakdown,
    breakdownLines: lines,
    caveat: GAUGE_CAVEAT,
    flagCount: tier1.findings.filter((f) => f.severity === "warn").length + aiFlagged,
  };
}

/** Short label for a band (UI + status messages). */
export function bandLabel(band: GaugeBand): string {
  switch (band) {
    case "ditahan":
      return "Ditahan — sitasi hantu";
    case "perlu-tinjau":
      return "Perlu ditinjau";
    case "cukup":
      return "Cukup — ada catatan";
    case "baik":
      return "Baik — lolos kedua tahap";
  }
}
