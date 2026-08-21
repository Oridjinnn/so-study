// TIER 2 — AI critic pass (flags only, NEVER a gate).
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT ALLOWED TO BLOCK ANYTHING
// ---------------------------------------------------------------------------
// This is a second Gemini call that reads each cited claim next to the paper it
// cites and returns "supported" / "uncertain" / "contradicted". It is a SECOND
// OPINION, not ground truth: an AI critic auditing an AI generator can be wrong
// in both directions — it can wave through a fabricated claim and it can flag a
// perfectly faithful one it simply failed to follow. So it produces flags for a
// human to read, and nothing here may reject content on its own. The report type
// carries a literal `blocks: false` field so that contract is greppable, typed,
// and asserted in tests rather than being a comment nobody enforces.
//
// Tier 1 (src/lib/tier1.ts) is the deterministic gate. Keep the two apart.
//
// COST CONTROL (this is a paid call, unlike Tier 1):
//   - Batched: claims are judged several per call, not one call per claim.
//   - Bounded: at most MAX_CLAIMS claims and therefore ceil(MAX_CLAIMS/batch)
//     calls per module, no matter how long the module is.
//   - Run ONCE per module at synthesis completion, cached on the Module row, and
//     re-run afterwards only for the claims a targeted repair actually touched
//     (see `mergeCriticReports`). Never on read.

import { z } from "zod";
import type { GeminiResponseSchema, GeminiUsage } from "./gemini";
import type { Tier1Module, Tier1Source } from "./tier1";
import { citedSentences } from "./tier1";

export type CriticVerdict = "supported" | "uncertain" | "contradicted";

/** One claim handed to the critic, already paired with its cited source. */
export interface CriticClaim {
  /** Verbatim claim sentence from the module. */
  claimText: string;
  /** Inline citation number the claim carries. */
  n: number;
  citedPaperId: string;
  paperTitle: string;
  /** The paper's abstract / fetched text — the only evidence the critic gets. */
  paperText: string;
}

/** One judgment. Shape is exactly what the model is asked to return, plus the
 * harness-resolved link back to the module claim (`claimIndex`). */
export interface CriticFlag {
  claimText: string;
  citedPaperId: string;
  verdict: CriticVerdict;
  note: string;
  /**
   * Index into the `claims` array the critic was given, or null when the
   * returned `claimText` could not be matched back to a real claim. Null is
   * reported rather than hidden: an unmatched judgment cannot be repaired in a
   * targeted way, and pretending otherwise would send the repair pass hunting
   * for a sentence that is not in the module.
   */
  claimIndex: number | null;
}

export interface CriticReport {
  /** False when the critic was skipped (no cited claims) or the call failed. */
  ran: boolean;
  /** Present when the critic could not produce a usable verdict set. */
  error?: string;
  /** Number of Gemini calls actually made. */
  batches: number;
  /** Claims submitted for judgment. */
  submitted: number;
  /** Judgments returned and parsed. */
  judged: number;
  /**
   * EVERY judgment, including "supported" — the gauge shows a verdict
   * distribution, and hiding the supported ones would make three flags out of
   * three claims look identical to three flags out of forty.
   */
  judgments: CriticFlag[];
  counts: { supported: number; uncertain: number; contradicted: number };
  /**
   * Structural reminder that Tier 2 is advisory. Always false. Callers deciding
   * whether to ship a module must read Tier 1's `blocked`, never this report.
   */
  blocks: false;
}

/** Hard ceiling on claims judged per module (cost bound, rule I7). */
export const MAX_CLAIMS = 24;
/** Claims per Gemini call. Batched to keep the call count low without making a
 * single prompt so long that the critic loses track of which claim it is on. */
export const CLAIMS_PER_BATCH = 6;

const VerdictSchema = z.enum(["supported", "uncertain", "contradicted"]);
const JudgmentSchema = z.object({
  claimText: z.string(),
  citedPaperId: z.string(),
  verdict: VerdictSchema,
  note: z.string(),
});
// The model may answer with a bare array (what the schema asks for) or wrap it
// in an object; both are accepted, anything else is a parse failure.
const BatchSchema = z.union([
  z.array(JudgmentSchema),
  z.object({ judgments: z.array(JudgmentSchema) }).transform((o) => o.judgments),
]);

/** The `responseSchema` sent to Gemini (JSON mode — no fenced-prose parsing). */
export const CRITIC_RESPONSE_SCHEMA: GeminiResponseSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      claimText: { type: "string" },
      citedPaperId: { type: "string" },
      verdict: { type: "string", enum: ["supported", "uncertain", "contradicted"] },
      note: { type: "string" },
    },
    required: ["claimText", "citedPaperId", "verdict", "note"],
  },
};

export const CRITIC_SYSTEM =
  "Kamu adalah pemeriksa fakta akademik. Untuk SETIAP klaim yang diberikan, " +
  "bandingkan klaim itu HANYA dengan teks sumber yang menyertainya (judul + " +
  "abstrak/teks paper). Putuskan: \"supported\" bila teks sumber mendukung " +
  "klaim, \"contradicted\" bila teks sumber menyatakan hal yang berlawanan, " +
  "\"uncertain\" bila teks sumber tidak cukup untuk menilai (termasuk bila " +
  "klaim membahas hal yang tidak disinggung sumber). Jangan memakai pengetahuan " +
  "di luar teks sumber. `note` berisi satu kalimat alasan singkat dalam Bahasa " +
  "Indonesia, dan `claimText` harus disalin PERSIS seperti yang diberikan. " +
  "Kembalikan satu entri untuk setiap klaim.";

/** Long paper texts are cut per claim: the abstract-sized head carries the
 * claim-relevant content, and an unbounded prompt is an unbounded bill. */
const MAX_SOURCE_CHARS = 2_400;

export function buildCriticPrompt(batch: CriticClaim[]): string {
  const blocks = batch.map((c, i) => {
    const text = c.paperText.length > MAX_SOURCE_CHARS
      ? `${c.paperText.slice(0, MAX_SOURCE_CHARS)}…`
      : c.paperText;
    return [
      `<<<KLAIM ${i + 1} START>>>`,
      `claimText: ${c.claimText}`,
      `citedPaperId: ${c.citedPaperId}`,
      `Sitasi inline: [${c.n}]`,
      `Judul sumber: ${c.paperTitle}`,
      `Teks sumber: ${text || "(teks sumber tidak tersedia)"}`,
      `<<<KLAIM ${i + 1} END>>>`,
    ].join("\n");
  });
  return (
    `Periksa ${batch.length} klaim berikut satu per satu terhadap teks sumbernya masing-masing.\n\n` +
    `${blocks.join("\n\n")}\n\n` +
    `Kembalikan array JSON dengan ${batch.length} entri, satu untuk setiap klaim, ` +
    `dengan field claimText (disalin persis), citedPaperId, verdict, note.`
  );
}

/**
 * Pair every cited claim sentence with the approved paper it cites.
 *
 * A sentence citing several papers yields one claim PER cited paper: "X and Y
 * both argue Z [1][2]" can be supported by one paper and contradicted by the
 * other, and collapsing that into one verdict would hide the disagreement.
 * Citations that resolve to no approved paper are skipped — that is a Tier 1
 * `fail`, and there is no source text to judge against.
 */
export function collectCitedClaims(
  module: Tier1Module,
  sources: Tier1Source[],
  max = MAX_CLAIMS,
): CriticClaim[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out: CriticClaim[] = [];
  const seen = new Set<string>();
  for (const { sentence, citations } of citedSentences(module.contentMarkdown)) {
    for (const n of citations) {
      const paperId =
        n >= 1 && n <= module.sourcePaperIds.length ? module.sourcePaperIds[n - 1] : undefined;
      if (!paperId) continue;
      const src = byId.get(paperId);
      if (!src) continue;
      const key = `${paperId}::${sentence}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        claimText: sentence,
        n,
        citedPaperId: paperId,
        paperTitle: src.title,
        paperText: src.text,
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}

export interface CriticGenerateFn {
  (opts: {
    system: string;
    prompt: string;
    maxOutputTokens?: number;
    responseMimeType?: "application/json" | "text/plain";
    responseSchema?: GeminiResponseSchema;
  }): Promise<{ text: string; usage?: GeminiUsage }>;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Match a returned claimText back to the submitted claim (exact → normalized →
 * prefix), so a model that trims or re-cases the sentence is still linkable. */
function matchClaimIndex(claims: CriticClaim[], returned: string): number | null {
  const exact = claims.findIndex((c) => c.claimText === returned);
  if (exact !== -1) return exact;
  const norm = normalize(returned);
  const same = claims.findIndex((c) => normalize(c.claimText) === norm);
  if (same !== -1) return same;
  if (norm.length >= 24) {
    const prefix = claims.findIndex(
      (c) => normalize(c.claimText).startsWith(norm.slice(0, 24)),
    );
    if (prefix !== -1) return prefix;
  }
  return null;
}

function emptyCounts() {
  return { supported: 0, uncertain: 0, contradicted: 0 };
}

/**
 * Judge `claims` in bounded batches. Never throws and never blocks: a failed or
 * malformed batch is recorded in `error`, the batches that did parse are kept,
 * and the report still says `blocks: false`.
 *
 * `onUsage` lets the caller log cost per call (the route logs AIUsage) without
 * this module importing Prisma.
 */
export async function runCritic(
  claims: CriticClaim[],
  generate: CriticGenerateFn,
  opts?: { batchSize?: number; onUsage?: (usage: GeminiUsage) => void | Promise<void> },
): Promise<CriticReport> {
  if (claims.length === 0) {
    return {
      ran: false,
      error: "tidak ada klaim bersitasi yang bisa diperiksa",
      batches: 0,
      submitted: 0,
      judged: 0,
      judgments: [],
      counts: emptyCounts(),
      blocks: false,
    };
  }

  const batchSize = Math.max(1, opts?.batchSize ?? CLAIMS_PER_BATCH);
  const judgments: CriticFlag[] = [];
  const counts = emptyCounts();
  const errors: string[] = [];
  let batches = 0;

  for (let i = 0; i < claims.length; i += batchSize) {
    const batch = claims.slice(i, i + batchSize);
    batches += 1;
    let raw: { text: string; usage?: GeminiUsage };
    try {
      raw = await generate({
        system: CRITIC_SYSTEM,
        prompt: buildCriticPrompt(batch),
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: CRITIC_RESPONSE_SCHEMA,
      });
    } catch (e) {
      // Network / key / safety block: this batch has no verdicts. Recorded, not
      // swallowed (rule I9), and explicitly NOT treated as "clean".
      errors.push(`batch ${batches}: ${(e as Error).message}`);
      continue;
    }
    if (opts?.onUsage && raw.usage) await opts.onUsage(raw.usage);
    let parsed: z.infer<typeof JudgmentSchema>[];
    try {
      parsed = BatchSchema.parse(JSON.parse(raw.text));
    } catch {
      errors.push(`batch ${batches}: keluaran kritikus tidak sesuai skema`);
      continue;
    }
    for (const j of parsed) {
      const claimIndex = matchClaimIndex(batch, j.claimText);
      counts[j.verdict] += 1;
      judgments.push({
        claimText: j.claimText,
        citedPaperId: j.citedPaperId,
        verdict: j.verdict,
        note: j.note,
        // Offset back into the full claim list so callers can look the claim up.
        claimIndex: claimIndex == null ? null : i + claimIndex,
      });
    }
  }

  return {
    ran: judgments.length > 0,
    error: errors.length ? errors.join("; ") : undefined,
    batches,
    submitted: claims.length,
    judged: judgments.length,
    judgments,
    counts,
    blocks: false,
  };
}

/** The judgments a human should look at: everything the critic did not call
 * "supported". These drive the gauge's "ditandai AI" count and the targeted
 * repair pass — as flags, never as a rejection. */
export function criticFlags(report: CriticReport | null | undefined): CriticFlag[] {
  if (!report) return [];
  return report.judgments.filter((j) => j.verdict !== "supported");
}

/**
 * Drop verdicts about claim texts that no longer exist in the module (a repaired
 * or removed sentence). Keeping them would leave the gauge counting flags for
 * prose the student can no longer read — the definition of a stale metric.
 */
export function pruneCriticReport(
  report: CriticReport | null | undefined,
  removedClaimTexts: string[],
): CriticReport | null {
  if (!report) return null;
  return mergeCriticReports(
    report,
    {
      ran: false,
      batches: 0,
      submitted: 0,
      judged: 0,
      judgments: [],
      counts: emptyCounts(),
      blocks: false,
    },
    removedClaimTexts,
  );
}

/**
 * Fold a re-run over TOUCHED claims into the cached report (Part 2 cost rule:
 * a repair that rewrites one claim must not pay to re-judge the whole module).
 *
 * Judgments whose claim text matches a fresh judgment are replaced; judgments
 * whose claim text no longer exists in the module are dropped by the caller
 * passing `removedClaimTexts` (a repaired-away sentence must not keep haunting
 * the gauge). Counts are recomputed from the merged set, never patched
 * incrementally, so they always describe the stored judgments.
 */
export function mergeCriticReports(
  previous: CriticReport | null | undefined,
  fresh: CriticReport,
  removedClaimTexts: string[] = [],
): CriticReport {
  const removed = new Set(removedClaimTexts.map(normalize));
  const freshKeys = new Set(fresh.judgments.map((j) => normalize(j.claimText)));
  const kept = (previous?.judgments ?? []).filter((j) => {
    const key = normalize(j.claimText);
    return !freshKeys.has(key) && !removed.has(key);
  });
  const judgments = [...kept, ...fresh.judgments];
  const counts = emptyCounts();
  for (const j of judgments) counts[j.verdict] += 1;
  const error = [previous?.error, fresh.error].filter(Boolean).join("; ") || undefined;
  return {
    ran: judgments.length > 0,
    error,
    batches: (previous?.batches ?? 0) + fresh.batches,
    submitted: (previous?.submitted ?? 0) + fresh.submitted,
    judged: judgments.length,
    judgments,
    counts,
    blocks: false,
  };
}
