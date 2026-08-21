// Post-generation grounding / faithfulness harness (whitepaper §4; rule I5).
//
// Contract: after synthesis produces a module, every inline `[n]` citation is
// checked against the paper it claims to come from. The check is a HARNESS, not
// a second model call: deterministic, dependency-free, and LLM-free by design —
// a hallucinating model must never be the auditor of a hallucinating model, and
// a grounding score that changes between two identical runs is not evidence.
//
// What it can and cannot prove:
//   - It CAN prove a citation is impossible (`[7]` when only 3 papers exist) and
//     that a sentence shares (almost) no vocabulary with the source it cites —
//     the fingerprint of post-rationalization, where prose is written first and
//     citations are sprinkled on afterwards.
//   - It CANNOT prove semantic faithfulness. Lexical overlap is a floor, not a
//     ceiling, so the thresholds are deliberately lenient (see the constants):
//     a false "flagged" on a legitimate short citation would train the student
//     to ignore the report, which is worse than not having one.
//
// Report shape is stable and JSON-serializable: it travels to the client in the
// synthesize SSE `done` event.

/** One approved paper, as text the harness can compare a sentence against. */
export interface GroundingSource {
  /** Paper id — must match the entry in `module.sourcePaperIds`. */
  id: string;
  title: string;
  /** Abstract / full text; title and text are searched together. */
  text: string;
}

/** The minimum module shape the harness needs (no Prisma types, no DB access). */
export interface GroundedModule {
  contentMarkdown: string;
  /** Paper ids in citation order: `[1]` → sourcePaperIds[0]. */
  sourcePaperIds: string[];
}

export interface GroundingFlag {
  /** 0-based position of this citation in document order (not the sentence no). */
  index: number;
  /** The 1-based number as written in the markdown: `[n]`. */
  n: number;
  /** Human-readable, auditable reason (carries the measured overlap). */
  reason: string;
}

export interface GroundingReport {
  /** True when nothing was flagged (a module with no citations is trivially ok). */
  ok: boolean;
  /** Number of inline citations examined. */
  checked: number;
  flagged: GroundingFlag[];
  /** 1 - flagged/checked, rounded to 4dp; 1 when there is nothing to check. */
  score: number;
}

/**
 * Minimum share of a cited sentence's content words that must also occur in the
 * cited source. Set LOW on purpose: modules are written in Bahasa Indonesia
 * while abstracts are often English, so a genuinely grounded sentence can share
 * only its key terms. 0.05 still catches the pathological case — prose with
 * essentially nothing in common with the paper it cites.
 */
export const GROUNDING_MIN_OVERLAP = 0.05;

/**
 * Sentences with fewer content words than this are not judgeable ("Lihat [2].",
 * a heading, a bullet stub) and are never flagged — only counted as checked.
 */
export const GROUNDING_MIN_TOKENS = 4;

/** Tokens shorter than this are not searched as substrings (see `overlap`). */
const SUBSTRING_MIN_LEN = 5;

/** Function-word hits needed before a language verdict is trusted at all. */
const LANG_MIN_EVIDENCE = 4;

// Indonesian + English function words. They carry no topical signal, so leaving
// them in would let a sentence "match" any source through grammar alone.
const STOPWORDS = new Set<string>([
  "dan", "atau", "yang", "dari", "pada", "untuk", "dengan", "dalam", "ini",
  "itu", "adalah", "akan", "bisa", "juga", "sudah", "saya", "kamu", "mereka",
  "kita", "apa", "bagaimana", "mengapa", "karena", "jika", "maka", "sebagai",
  "oleh", "saat", "setelah", "sebelum", "antara", "terhadap", "tentang",
  "tidak", "dapat", "serta", "namun", "tetapi", "lebih", "sangat", "para",
  "the", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are",
  "was", "were", "been", "being", "that", "this", "as", "at", "by", "from",
  "we", "you", "they", "how", "why", "what", "because", "then", "but", "not",
  "its", "their", "which", "these", "those", "such", "also", "can", "may",
]);

/** Lowercased alphanumeric content tokens, stopwords and 1–2 char noise dropped. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Function words are the cheapest reliable language signal, and they are exactly
// the tokens `tokenize` throws away — so language detection reads the raw words.
// Disjoint marker sets, Indonesian vs English.
const ID_MARKERS = new Set<string>([
  "dan", "yang", "dari", "pada", "untuk", "dengan", "dalam", "ini", "itu",
  "adalah", "tidak", "akan", "juga", "karena", "sebagai", "oleh", "atau",
  "tersebut", "bahwa", "serta", "dapat", "para", "terhadap", "antara",
]);
const EN_MARKERS = new Set<string>([
  "the", "and", "of", "to", "that", "is", "are", "this", "for", "with",
  "which", "between", "through", "from", "their", "was", "were", "these",
  "how", "while", "whose", "its",
]);

/**
 * Cheap, deterministic language verdict — `null` when the evidence is thin or
 * the text is bilingual (then the lexical check runs as normal).
 *
 * Why this exists: OpenAlex abstracts are usually English while the module is
 * written in Bahasa Indonesia. A faithfully translated sentence can share ZERO
 * tokens with the abstract it summarises, so a naive lexical check would flag
 * almost every citation in a perfectly grounded module — and a report that cries
 * wolf every time teaches the student to ignore it.
 */
function detectLanguage(text: string): "id" | "en" | null {
  let id = 0;
  let en = 0;
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (ID_MARKERS.has(w)) id += 1;
    else if (EN_MARKERS.has(w)) en += 1;
  }
  if (id + en < LANG_MIN_EVIDENCE) return null;
  if (id >= en * 2) return "id";
  if (en >= id * 2) return "en";
  return null;
}

// One sentence per run of non-terminator characters; newlines end a sentence too
// so markdown headings and list items are judged separately. Written without a
// lookbehind so the pattern is portable across the repo's ES target.
function splitSentences(markdown: string): string[] {
  return (markdown.match(/[^.!?\n]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface IndexedSource {
  tokens: Set<string>;
  /** Token stream joined with spaces — used for cheap affix-tolerant matching. */
  joined: string;
  lang: "id" | "en" | null;
}

function indexSource(src: GroundingSource): IndexedSource {
  const combined = `${src.title} ${src.text}`;
  const tokens = tokenize(combined);
  return { tokens: new Set(tokens), joined: tokens.join(" "), lang: detectLanguage(combined) };
}

/**
 * Asymmetric lexical overlap: the share of the sentence's distinct content words
 * found in the source. Jaccard is wrong here — a 12-word sentence against a
 * 200-word abstract can never exceed ~0.06 even when every word matches, so it
 * would flag correctly grounded prose. Coverage-of-the-claim is the question we
 * actually care about ("is this sentence's vocabulary in the paper?").
 *
 * Substring matching (tokens ≥ 5 chars) absorbs Indonesian affixation
 * ("budaya" inside "kebudayaan") without a stemmer dependency.
 *
 * Returns 1 when there is nothing to compare: unjudgeable is not evidence of
 * fabrication, and flagging it would only teach the student to ignore flags.
 */
function overlap(sentenceTokens: string[], src: IndexedSource): number {
  const distinct = new Set(sentenceTokens);
  if (distinct.size === 0 || src.tokens.size === 0) return 1;
  let hits = 0;
  for (const t of distinct) {
    if (src.tokens.has(t) || (t.length >= SUBSTRING_MIN_LEN && src.joined.includes(t))) {
      hits += 1;
    }
  }
  return hits / distinct.size;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Verify that every inline `[n]` citation in a synthesized module is (a) a
 * citation that can exist and (b) lexically anchored in the paper it names.
 *
 * Pure and deterministic: same inputs → identical report, always.
 */
export function verifyGrounding(
  module: GroundedModule,
  sources: GroundingSource[],
): GroundingReport {
  const byId = new Map<string, IndexedSource>();
  for (const s of sources) {
    // First entry wins: a duplicated paper id must not change the verdict.
    if (!byId.has(s.id)) byId.set(s.id, indexSource(s));
  }

  const flagged: GroundingFlag[] = [];
  let checked = 0;
  const moduleLang = detectLanguage(module.contentMarkdown);

  for (const sentence of splitSentences(module.contentMarkdown)) {
    const citations = sentence.match(/\[\d+\]/g);
    if (!citations) continue;
    // Tokenize the sentence once, with the citation markers stripped so the
    // numbers themselves can never count as shared vocabulary.
    const sentenceTokens = tokenize(sentence.replace(/\[\d+\]/g, " "));

    for (const marker of citations) {
      const n = Number(marker.slice(1, -1));
      const index = checked;
      checked += 1;

      if (!Number.isInteger(n) || n < 1 || n > module.sourcePaperIds.length) {
        flagged.push({
          index,
          n,
          reason:
            `citation [${n}] is out of range: the module lists ` +
            `${module.sourcePaperIds.length} source(s) — possible post-rationalization`,
        });
        continue;
      }

      const paperId = module.sourcePaperIds[n - 1];
      const src = byId.get(paperId);
      if (!src) {
        flagged.push({
          index,
          n,
          reason: `source text for [${n}] (paper ${paperId}) was not supplied — citation unverifiable`,
        });
        continue;
      }

      // Too short to judge: counted, never flagged (legitimate short citation).
      if (sentenceTokens.length < GROUNDING_MIN_TOKENS) continue;

      // Cross-language pair (Indonesian module, English abstract): the lexical
      // floor carries no information, so the citation is counted as checked but
      // never flagged. A false accusation is worse than a missed one here —
      // the structural checks above still apply unconditionally.
      if (moduleLang && src.lang && moduleLang !== src.lang) continue;

      const score = overlap(sentenceTokens, src);
      if (score < GROUNDING_MIN_OVERLAP) {
        flagged.push({
          index,
          n,
          reason:
            `lexical overlap ${round4(score)} with source [${n}] is below ` +
            `${GROUNDING_MIN_OVERLAP} — possible post-rationalization`,
        });
      }
    }
  }

  return {
    ok: flagged.length === 0,
    checked,
    flagged,
    score: checked === 0 ? 1 : round4(1 - flagged.length / checked),
  };
}
