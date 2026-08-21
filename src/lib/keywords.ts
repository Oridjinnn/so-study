// Deterministic keyword expansion for paper retrieval (no LLM, no IO).
// Pure and unit-tested in keywords.test.ts.
//
// Why this exists: every provider folds `query + keywords + major` into a single
// free-text search term, so MORE, better-chosen terms => a WIDER paper net
// (coverage) without any model call. Expansion is heuristic and bounded by the
// same guards that bound the retrieval endpoint (LIMITS.keywordCount /
// keywordChars), so a long topic title can never blow up the upstream query.

import { LIMITS } from "./guards";

const STOPWORDS = new Set(
  (
    "dan atau dari pada ke dalam yang dengan untuk oleh adalah merupakan sebagai " +
    "ini itu dia kami kita mereka ada tidak akan dapat sangat lebih karena selain " +
    "antara tentang terhadap sebuah sebuahnya dengan the and of for to in on with " +
    "pada secara yang"
  ).split(" "),
);

/** Significant single tokens from a title (length >= 4, not a stopword). */
export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Expand a topic title + any user-supplied keywords into a richer, deduplicated
 * term list used for the provider search.
 *
 * Strategy (deterministic, no synonyms needed):
 *  1. user keywords first — explicit intent wins;
 *  2. significant title tokens — single-concept terms;
 *  3. adjacent title bigrams — phrase-level variants that widen recall without
 *     needing a dictionary ("teori budaya" matches more than either word alone).
 *
 * The result is capped by `max` (default LIMITS.keywordCount) and by the
 * keyword character budget, so it always fits the retrieval guard.
 */
export function expandKeywords(
  title: string,
  keywords: string[] = [],
  opts: { max?: number } = {},
): string[] {
  const max = Math.max(1, opts.max ?? LIMITS.keywordCount);
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (raw: string) => {
    const k = raw.trim().replace(/\s+/g, " ");
    if (!k) return;
    const key = k.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(k);
  };

  for (const kw of keywords) add(kw);

  const toks = titleTokens(title);
  for (const t of toks) add(t);
  for (let i = 0; i + 1 < toks.length; i++) add(`${toks[i]} ${toks[i + 1]}`);

  // Count cap first, then trim to the character budget so the upstream query
  // never exceeds what the guard allows.
  const byCount = out.slice(0, max);
  const within: string[] = [];
  let chars = 0;
  for (const k of byCount) {
    if (chars + k.length + 1 > LIMITS.keywordChars) break;
    within.push(k);
    chars += k.length + 1;
  }
  return within;
}

/**
 * Concise scoring terms: the user's keywords plus the title's significant
 * single tokens (NO bigrams). Used for relevance ranking — kept short so the
 * overlap ratio in `relevanceScore` stays meaningful (a long expanded query
 * would otherwise dilute every paper's score toward zero).
 */
export function scoringTerms(title: string, keywords: string[] = []): string[] {
  const base = [...keywords, ...titleTokens(title)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of base) {
    const key = k.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(k.trim());
  }
  return out.length ? out : [title];
}
