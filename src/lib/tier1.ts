// TIER 1 — deterministic accuracy checks (the real hard gate; NO AI call).
//
// ---------------------------------------------------------------------------
// WHAT THIS TIER MEASURES, AND WHAT IT DOES NOT
// ---------------------------------------------------------------------------
// Tier 1 checks STRUCTURAL GROUNDING only: does every inline `[n]` point at a
// paper the human actually approved, do claim-like sentences carry a citation at
// all, and do the specific names/numbers written next to a citation also occur
// in that paper's stored text.
//
// It does NOT check substantive accuracy. A sentence can pass all three checks
// and still misread its source: "Bourdieu [2] argues the opposite of what he
// argues" is structurally perfect and substantively wrong. Judging that is
// Tier 2's job (src/lib/critic.ts), and Tier 2 is a second opinion, not a gate.
// Do not conflate the two tiers in code, in copy, or in the gauge — the whole
// point of splitting them is that one is deterministic evidence and the other is
// a model's opinion.
//
// Why deterministic: it is cheap, it is identical on two identical runs (a score
// that moves on its own is not evidence), and it cannot hallucinate a verdict.
// That is exactly why it — and only it — is allowed to block shipping.
//
// Severity contract (deliberate, not arbitrary):
//   - `fail` — phantom citation: an `[n]` with no approved paper behind it.
//     Unambiguously wrong, no judgement call, so it BLOCKS the module.
//   - `warn` — uncited-claim ratio over threshold, and named entities near a
//     citation that are missing from the source. Both have legitimate false
//     positives (framing sentences need no citation; a paraphrased number will
//     not match literally), so they are surfaced for human review and NEVER
//     block. A gate that cries wolf teaches the student to ignore it.
//
// Pure and dependency-free: same inputs → identical report, always.

import { mcqHelpers } from "./mcq";

/** One approved paper, as the text Tier 1 can match against. */
export interface Tier1Source {
  /** Paper id — must match the entry in `sourcePaperIds`. */
  id: string;
  title: string;
  /** Abstract / fetched full text; title and text are searched together. */
  text: string;
}

/** The minimum module shape Tier 1 needs (no Prisma types, no DB access). */
export interface Tier1Module {
  contentMarkdown: string;
  /** Approved paper ids in citation order: `[1]` → sourcePaperIds[0]. */
  sourcePaperIds: string[];
}

export type Tier1Check = "citation_exists" | "uncited_claim_ratio" | "entity_grounding";
export type Tier1Severity = "fail" | "warn";

export interface Tier1Finding {
  check: Tier1Check;
  severity: Tier1Severity;
  /**
   * The exact sentence/line the finding is about. Carried verbatim so the
   * targeted regeneration pass (src/lib/repair.ts) can quote it back to the
   * model instead of asking for a blind "improve this module" rewrite.
   */
  claimText: string;
  /** The `[n]` involved, or null for findings that are not tied to a citation. */
  n: number | null;
  /** The approved paper `[n]` resolves to, or null when it resolves to nothing. */
  citedPaperId: string | null;
  /** Human-readable, auditable reason (carries the measured evidence). */
  reason: string;
}

export interface Tier1Report {
  /** True when there is no `fail` finding. */
  passed: boolean;
  /**
   * The shipping gate. Identical to `!passed` today and kept as its own field on
   * purpose: callers that decide whether a student may read the module read
   * `blocked`, so the gate stays greppable and can never be confused with the
   * advisory Tier 2 result (which has no such field).
   */
  blocked: boolean;
  citations: { total: number; valid: number; phantom: number };
  claims: {
    total: number;
    uncited: number;
    /** uncited/total, 4dp; 0 when there are no claims. */
    ratio: number;
    threshold: number;
    overThreshold: boolean;
  };
  entities: { checked: number; mismatched: number };
  findings: Tier1Finding[];
}

/**
 * Flag point for the share of claim-like sentences carrying no citation at all.
 *
 * 30% is a STARTING point to be tuned against real modules, not a derived
 * constant: some sentences (advance organizers, transitions, reflection
 * questions) legitimately cite nothing, and the claim-cue regex inherited from
 * MCQ generation is deliberately broad, so a low ratio is not achievable and a
 * strict threshold would fire on healthy modules.
 */
export const UNCITED_RATIO_THRESHOLD = 0.3;

/** Max `warn` findings emitted per check — keeps a stored report bounded (I7). */
const MAX_FINDINGS_PER_CHECK = 10;

/** Findings quote the offending sentence; long ones are cut to keep rows small. */
const MAX_CLAIM_CHARS = 400;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function clip(text: string): string {
  const t = text.trim();
  return t.length <= MAX_CLAIM_CHARS ? t : `${t.slice(0, MAX_CLAIM_CHARS - 1)}…`;
}

/**
 * Sentence split that keeps markdown structure: a newline ends a sentence, so a
 * heading or a bullet is judged on its own rather than merged into the next
 * paragraph. Written without a lookbehind for ES-target portability (same shape
 * as src/lib/grounding.ts, which this tier sits beside rather than replaces).
 */
export function splitSentences(markdown: string): string[] {
  return (markdown.match(/[^.!?\n]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface CitedSentence {
  sentence: string;
  /** Every distinct `[n]` in the sentence, in order of appearance. */
  citations: number[];
}

/** Sentences that carry at least one inline `[n]`, with their citation numbers. */
export function citedSentences(markdown: string): CitedSentence[] {
  const out: CitedSentence[] = [];
  for (const sentence of splitSentences(markdown)) {
    const markers = sentence.match(/\[\d+\]/g);
    if (!markers) continue;
    const citations: number[] = [];
    for (const m of markers) {
      const n = Number(m.slice(1, -1));
      if (Number.isInteger(n) && !citations.includes(n)) citations.push(n);
    }
    if (citations.length) out.push({ sentence, citations });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Check 3 — named-entity / specific-number grounding
// ---------------------------------------------------------------------------
// Regex-based on purpose: an NLP/NER dependency would add a model download and
// a language assumption to catch a class of error that a proper-noun-shaped
// token already catches. The trade-off is false positives (Indonesian
// capitalises differently than English, and a paraphrased or unit-converted
// number will not match literally) — which is exactly why this check WARNS.

/**
 * Words that are capitalised for reasons other than being a proper noun:
 * sentence-initial function words, month names, and the module's own scaffold
 * vocabulary (headings, callout prefixes). Matching these would flag every
 * sentence and drown the real signal.
 */
const CAP_NOISE = new Set<string>([
  // Indonesian sentence-initial / connective words
  "Dalam", "Dengan", "Untuk", "Pada", "Karena", "Namun", "Tetapi", "Sebaliknya",
  "Selain", "Setelah", "Sebelum", "Ketika", "Saat", "Jika", "Maka", "Oleh",
  "Sementara", "Melalui", "Berdasarkan", "Menurut", "Sebagai", "Adapun",
  "Artinya", "Misalnya", "Contohnya", "Hal", "Ini", "Itu", "Di", "Ke", "Dari",
  "Dan", "Atau", "Bahwa", "Tidak", "Akan", "Dapat", "Secara", "Kedua",
  "Pertama", "Terakhir", "Akhirnya", "Konsep", "Teori", "Modul", "Tujuan",
  "Rangkuman", "Pertanyaan", "Contoh", "Definisi", "Sumber", "Bagian",
  "Perbandingan", "Kontras", "Implikasi", "Analisis", "Studi", "Penelitian",
  // English equivalents (abstracts and some module prose are English)
  "The", "This", "That", "These", "Those", "There", "Here", "However",
  "Therefore", "Although", "While", "When", "Because", "Their", "Its",
]);

/** Proper-noun-shaped tokens: `Bourdieu`, `Peter Berger`, `UNESCO`.
 *
 * Two conservative filters keep this from firing on ordinary Indonesian prose,
 * where every sentence opens with a capital and concept labels are title-cased:
 *
 *   1. `lowerVocab` — words the MODULE ITSELF also writes in lowercase are not
 *      proper names. "Moderasi" in "Moderasi Beragama" is a title-cased concept
 *      label because the module also writes "moderasi" in running prose;
 *      "Bourdieu" never appears lowercase anywhere. This uses the document as
 *      its own dictionary, so it needs no word list and no NLP dependency.
 *   2. A single capitalised word at the START of a sentence is skipped unless it
 *      is an acronym: sentence-initial capitalisation carries no information.
 *      Multi-word capitalised phrases ("Peter Berger …") are kept even at the
 *      start, because two capitals in a row is a real name signal.
 *
 * The result is deliberately biased toward MISSING a paraphrased detail rather
 * than accusing healthy prose — a check that cries wolf trains the student to
 * ignore the whole gauge, and Tier 2 reads these same claims from another angle.
 */
function properNouns(sentence: string, lowerVocab: Set<string>): string[] {
  const cleaned = sentence.replace(/\[\d+\]/g, " ");
  const out: string[] = [];
  const re = /\b([A-ZÀ-Þ][\p{L}]+(?:\s+[A-ZÀ-Þ][\p{L}]+)*|[A-Z]{3,})\b/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const phrase = m[1].trim();
    const atStart = cleaned.slice(0, m.index).trim().length === 0;
    const isAcronym = /^[A-Z]{3,}$/.test(phrase);
    let words = phrase.split(/\s+/).filter((w) => !CAP_NOISE.has(w));
    // Words the module also writes lowercase are common nouns, not names.
    words = words.filter((w) => !lowerVocab.has(w.toLowerCase()));
    if (words.length === 0) continue;
    if (atStart && words.length === 1 && !isAcronym) continue;
    const kept = words.join(" ");
    if (kept.length < 4) continue;
    out.push(kept);
  }
  return Array.from(new Set(out));
}

/** Words the module writes in lowercase somewhere — its own common-noun list. */
function lowercaseVocabulary(markdown: string): Set<string> {
  const out = new Set<string>();
  for (const w of markdown.match(/\p{Ll}[\p{L}]*/gu) ?? []) out.add(w.toLowerCase());
  return out;
}

/**
 * "Specific" numbers only: years, percentages, decimals and 3+ digit counts.
 * A bare "3" ("tiga dimensi") is not a checkable factual detail — flagging it
 * would produce noise, not signal.
 */
function specificNumbers(sentence: string): string[] {
  const cleaned = sentence.replace(/\[\d+\]/g, " ");
  const out: string[] = [];
  const re = /\b\d+(?:[.,]\d+)?%?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const raw = m[0];
    const digits = raw.replace(/[^\d]/g, "");
    const isPercent = raw.includes("%");
    const isDecimal = /[.,]\d/.test(raw);
    if (isPercent || isDecimal || digits.length >= 3) out.push(raw);
  }
  return Array.from(new Set(out));
}

/** Case-insensitive containment against the paper's title + stored text. */
function sourceContains(haystack: string, needle: string): boolean {
  return haystack.includes(needle.toLowerCase());
}

/**
 * Does a proper noun occur in the source? A multi-word phrase counts as present
 * when the phrase matches OR when every word of it does (abstracts reorder names
 * — "Peter Berger" vs "Berger, P."), which keeps the check about the ENTITY
 * rather than the exact string.
 */
function entityInSource(haystack: string, entity: string): boolean {
  if (sourceContains(haystack, entity)) return true;
  const words = entity.split(/\s+/);
  return words.length > 1 && words.every((w) => sourceContains(haystack, w));
}

/**
 * Number match tolerates thousands separators and decimal-comma/point variants
 * ("1.500" vs "1500", "0,75" vs "0.75") so pure formatting never reads as a
 * fabricated figure.
 */
function numberInSource(haystack: string, raw: string): boolean {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return true;
  if (sourceContains(haystack, raw)) return true;
  if (haystack.includes(digits)) return true;
  const swapped = raw.includes(",") ? raw.replace(",", ".") : raw.replace(".", ",");
  return sourceContains(haystack, swapped);
}

/**
 * Run every Tier 1 check against a module and its APPROVED papers.
 *
 * `sources` must be the approved `Paper` records for the topic, and
 * `module.sourcePaperIds` must be in citation order (`[1]` → index 0) — that
 * ordering IS the citation index, so a citation is "valid" precisely when
 * `sourcePaperIds[n-1]` exists and names an approved paper that was supplied.
 */
export function verifyTier1(module: Tier1Module, sources: Tier1Source[]): Tier1Report {
  const byId = new Map<string, string>();
  for (const s of sources) {
    // First entry wins: a duplicated paper id must not change the verdict.
    if (!byId.has(s.id)) byId.set(s.id, `${s.title}\n${s.text}`.toLowerCase());
  }

  const findings: Tier1Finding[] = [];

  // --- Check 1: citation existence (HARD FAIL) -----------------------------
  // Counted per (sentence, n) pair — one claim→source RELATION. A sentence that
  // writes "[2] … [2]" is one relation, not two: double-counting it would make
  // the gauge's "valid/total" imply more independent evidence than exists.
  let citationsTotal = 0;
  let citationsValid = 0;
  let phantom = 0;
  const reportedPhantom = new Set<string>();
  for (const { sentence, citations } of citedSentences(module.contentMarkdown)) {
    for (const n of citations) {
      citationsTotal += 1;
      const paperId =
        n >= 1 && n <= module.sourcePaperIds.length ? module.sourcePaperIds[n - 1] : undefined;
      const known = paperId != null && byId.has(paperId);
      if (known) {
        citationsValid += 1;
        continue;
      }
      phantom += 1;
      // One finding per (sentence, n) pair: the repair pass needs the sentence,
      // and repeating the same pair would inflate the report without adding
      // information.
      const key = `${n}::${sentence}`;
      if (reportedPhantom.has(key)) continue;
      reportedPhantom.add(key);
      findings.push({
        check: "citation_exists",
        severity: "fail",
        claimText: clip(sentence),
        n,
        citedPaperId: paperId ?? null,
        reason:
          paperId == null
            ? `sitasi [${n}] tidak ada: modul ini hanya punya ${module.sourcePaperIds.length} paper yang disetujui`
            : `sitasi [${n}] menunjuk paper ${paperId} yang tidak ada di daftar paper disetujui topik ini`,
      });
    }
  }

  // --- Check 2: uncited-claim ratio (WARN) ---------------------------------
  // Same claim definition as MCQ excerpt selection (mcqHelpers.extractClaims),
  // but uncapped: a truncated sample would produce a flattering ratio.
  const claims = mcqHelpers.extractClaims(module.contentMarkdown, Infinity);
  const uncited = claims.filter((c) => c.paperIndex == null);
  const claimsTotal = claims.length;
  const ratio = claimsTotal === 0 ? 0 : round4(uncited.length / claimsTotal);
  const overThreshold = ratio > UNCITED_RATIO_THRESHOLD;
  if (overThreshold) {
    // Only over the threshold do individual uncited claims become findings:
    // below it they are considered normal framing prose, so listing them would
    // hand the repair pass work that is not actually wrong.
    for (const c of uncited.slice(0, MAX_FINDINGS_PER_CHECK)) {
      findings.push({
        check: "uncited_claim_ratio",
        severity: "warn",
        claimText: clip(c.text),
        n: null,
        citedPaperId: null,
        reason:
          `klaim tanpa penanda sitasi apa pun; rasio klaim tanpa sitasi ` +
          `${Math.round(ratio * 100)}% di atas ambang ${Math.round(UNCITED_RATIO_THRESHOLD * 100)}%`,
      });
    }
  }

  // --- Check 3: named-entity / number grounding (WARN) ---------------------
  let entitiesChecked = 0;
  let entitiesMismatched = 0;
  let entityFindings = 0;
  const lowerVocab = lowercaseVocabulary(module.contentMarkdown);
  for (const { sentence, citations } of citedSentences(module.contentMarkdown)) {
    // Only sentences whose citations all resolve are judgeable here; a phantom
    // citation is already a `fail` and has no source text to compare against.
    const haystacks: string[] = [];
    for (const n of citations) {
      const paperId =
        n >= 1 && n <= module.sourcePaperIds.length ? module.sourcePaperIds[n - 1] : undefined;
      const text = paperId != null ? byId.get(paperId) : undefined;
      if (text) haystacks.push(text);
    }
    if (haystacks.length === 0) continue;

    const entities = properNouns(sentence, lowerVocab);
    const numbers = specificNumbers(sentence);
    const missing: string[] = [];
    for (const e of entities) {
      entitiesChecked += 1;
      // Present in ANY cited source counts: a sentence citing [1][3] may draw
      // the name from either paper.
      if (!haystacks.some((h) => entityInSource(h, e))) missing.push(e);
    }
    for (const num of numbers) {
      entitiesChecked += 1;
      if (!haystacks.some((h) => numberInSource(h, num))) missing.push(num);
    }
    if (missing.length === 0) continue;
    entitiesMismatched += missing.length;
    if (entityFindings >= MAX_FINDINGS_PER_CHECK) continue;
    entityFindings += 1;
    findings.push({
      check: "entity_grounding",
      severity: "warn",
      claimText: clip(sentence),
      n: citations[0],
      citedPaperId:
        citations[0] >= 1 && citations[0] <= module.sourcePaperIds.length
          ? module.sourcePaperIds[citations[0] - 1]
          : null,
      reason:
        `nama/angka spesifik dekat sitasi tidak ditemukan di teks sumber: ` +
        `${missing.slice(0, 5).join(", ")} — bisa detail fabrikasi, bisa juga parafrase (perlu dilihat manusia)`,
    });
  }

  const passed = findings.every((f) => f.severity !== "fail");
  return {
    passed,
    blocked: !passed,
    citations: { total: citationsTotal, valid: citationsValid, phantom },
    claims: {
      total: claimsTotal,
      uncited: uncited.length,
      ratio,
      threshold: UNCITED_RATIO_THRESHOLD,
      overThreshold,
    },
    entities: { checked: entitiesChecked, mismatched: entitiesMismatched },
    findings,
  };
}
