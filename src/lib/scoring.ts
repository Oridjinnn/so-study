// Pure, deterministic heuristic scoring for paper retrieval.
// No LLM, no IO — unit-tested in scoring.test.ts.
//
// `semanticRelevance` (below) is the ONLY function here that does IO: it
// dynamically imports `@/src/lib/gemini` so the embedding client is never
// statically pulled into the client bundle (PaperReview.tsx imports this file
// directly and must stay server-free). Every other helper stays pure.

export interface ScoringPaper {
  title: string;
  abstract: string;
  year: number;
  citationCount: number;
  /** ISO-639-1 language code when the provider knows it ("id" | "en" | …). */
  language?: string;
  /** Bibliographic type, when known ("journal" | "article" | "book" | …). */
  type?: string;
  /** Journal/conference/series title, when known. */
  venue?: string;
  /**
   * Dense cosine similarity (0..1, occasionally negative) between the topic and
   * this paper's `title + abstract` embedding. Populated only when the semantic
   * filter runs; absent on the lexical-only / embedding-failure fallback path.
   */
  semanticRelevance?: number;
}

/**
 * A paper counts as an *international journal* when it is a journal-type work
 * (has a venue and is not a book) written in a non-Indonesian language.
 *
 * Language is only known for a few providers (DOAJ tags "id" for Indonesian
 * journals); the four international indices (OpenAlex / Crossref / Semantic
 * Scholar / PubMed) are English-dominant and leave `language` untagged, so an
 * untagged journal work from them is treated as international. Indonesian
 * journals (DOAJ-tagged "id") are the domestic leg and are excluded — so-study
 * deliberately keeps its source pool internationally broad.
 */
export function isInternationalJournal(p: {
  type?: string | null;
  venue?: string | null;
  language?: string | null;
}): boolean {
  const isBook = p.type === "book";
  const isJournal =
    p.type === "journal" ||
    ((p.type === "article" || p.type === undefined) && !!p.venue?.trim());
  if (!isJournal || isBook) return false;
  if (p.language === "id") return false;
  return true;
}

/**
 * Context-aware minimum number of international-journal papers for a shortlist.
 *
 * Historically this was a fixed `2` applied to EVERY topic, which wrongly forced
 * two lower-relevance international papers into the pool even for legitimately
 * domestic-literature topics (Indonesian law, local bureaucracy, domestic policy
 * implementation) — those are correctly studied from Indonesian-language
 * secondary literature. The requirement is now tied to the course's jurusan:
 * only genuinely international / comparative / global topics keep the quota.
 * Everything else defaults to `0` (no forced international papers) so relevance
 * — not a rigid heuristic — drives the shortlist.
 */
export function internationalQuotaForMajor(major?: string | null): number {
  if (!major) return 0;
  const m = major.toLowerCase();
  return /(internasional|international|komparatif|comparative|global|hubungan internasional)/.test(m)
    ? 2
    : 0;
}

export interface ScoringOptions {
  /** Max citation count in the batch, for normalization. Falls back to log scale. */
  maxCitations?: number;
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Relevance = keyword overlap (0..1) weighted with citation and recency signals.
 * Deterministic and bounded in [0,1].
 */
export function relevanceScore(
  p: ScoringPaper,
  terms: string[],
  opts: ScoringOptions = {}
): number {
  const q = terms.map((t) => t.toLowerCase()).filter(Boolean);
  if (q.length === 0) return 0;

  const text = `${p.title} ${p.abstract}`.toLowerCase();
  const hits = q.filter((t) => text.includes(t)).length;
  const overlap = hits / q.length;

  const denom = opts.maxCitations && opts.maxCitations > 0 ? opts.maxCitations : 1;
  const citationNorm = Math.min(1, Math.log1p(p.citationCount) / Math.log1p(denom));

  const recency =
    p.year >= 2015 ? 1 : p.year >= 2000 ? 0.7 : p.year >= 1980 ? 0.4 : 0.2;

  // Language nudge: works in the student's primary languages (Indonesian +
  // English) are surfaced without excluding other-language sources. The bonus
  // is small and additive so relevance overlap still dominates the ranking.
  const LANGUAGE_BONUS = 0.05;
  const langBonus = p.language === "id" || p.language === "en" ? LANGUAGE_BONUS : 0;

  return Math.round((0.6 * overlap + 0.25 * citationNorm + 0.15 * recency + langBonus) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Semantic relevance (dense retrieval) — Change: drop off-topic via meaning,
// not lexical overlap. Lexical `relevanceScore` matches "aktor" the IR agent
// and "aktor" the performer equally; cosine similarity over embeddings does
// not, which is exactly the failure we are closing (see task brief).
// ---------------------------------------------------------------------------

/** Cosine similarity of two equal-length vectors, in [-1, 1]. Returns 0 for a
 *  zero/degenerate vector so callers never divide by zero. Pure. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Dense relevance of each paper to the topic, as cosine similarity between the
 * topic embedding and the paper's `title + abstract` embedding. Returns one
 * score per input paper, in input order.
 *
 * This is the only IO function in the module: it dynamically imports
 * `@/src/lib/gemini` (so the embedding client stays out of the client bundle)
 * and calls `embedTexts`. It is best-effort by contract — it REJECTS on any
 * embedding failure (missing key, network, surprise shape) and the caller is
 * expected to catch and fall back to lexical scoring. It never returns partial
 * or fabricated scores.
 */
export async function semanticRelevance(
  topic: string,
  papers: { title: string; abstract?: string }[]
): Promise<number[]> {
  if (papers.length === 0) return [];
  const { embedTexts } = await import("@/src/lib/gemini");
  const texts = [topic, ...papers.map((p) => `${p.title}. ${p.abstract ?? ""}`)];
  const vectors = await embedTexts(texts);
  const topicVec = vectors[0];
  return papers.map((_, i) => cosineSimilarity(topicVec, vectors[i + 1]));
}

// ---------------------------------------------------------------------------
// Dedupe — near-identical titles or same first-author + year.
// ---------------------------------------------------------------------------

/** Normalize a title to a comparable key: lowercase, alnum-only, single spaces. */
export function normalizePaperTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable key for the FIRST author (ignores initials/separators). */
function firstAuthorKey(authors: string | undefined): string {
  const first = (authors ?? "").split(/,| and /i)[0]?.trim().toLowerCase() ?? "";
  return first.replace(/[^a-z0-9]+/g, " ");
}

/** Classic Levenshtein edit distance (small strings only). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

/**
 * Drop near-duplicate papers: keep the first occurrence of each work.
 * A paper is considered a duplicate of an already-kept one when either:
 *   - their normalized titles are identical, or near-identical (edit distance
 *     <= 2 on sufficiently long titles), or
 *   - they share the same first author AND publication year.
 * Pure and order-stable (keeps the earliest-seen). The caller still runs
 * `dedupeAndMerge` (DOI-based) upstream; this catches same-work diff-DOI and
 * same-author/year collisions that DOI grouping misses.
 */
export function dedupePapers<T extends { title: string; year: number; authors?: string }>(
  papers: T[]
): T[] {
  const out: T[] = [];
  for (const p of papers) {
    const titleKey = normalizePaperTitle(p.title);
    const authorKey = firstAuthorKey(p.authors);
    const isDup = out.some((q) => {
      const qTitle = normalizePaperTitle(q.title);
      const titleDup =
        qTitle === titleKey ||
        (titleKey.length >= 8 &&
          qTitle.length >= 8 &&
          levenshtein(qTitle, titleKey) <= 2);
      const authorDup =
        authorKey.length > 0 &&
        firstAuthorKey(q.authors) === authorKey &&
        q.year === p.year;
      return titleDup || authorDup;
    });
    if (!isDup) out.push(p);
  }
  return out;
}

export interface ShortlistOptions {
  /** Absolute floor on how many papers to keep. Default 2. */
  minCount?: number;
  /** Hard ceiling on the shortlist size (prevents an unbounded review list). */
  maxCount?: number;
  /**
   * Minimum number of international-journal papers (per `isInternationalJournal`)
   * the shortlist must contain. When the top-k is short on them, the next-best
   * international candidates replace the lowest-relevance domestic/non-journal
   * entries so breadth is preserved (so-study's source pool stays internationally
   * broad). Default 0 (no quota).
   */
  minInternational?: number;
  /** If true, fill the floor by recency when relevance is weak. Default true. */
  useRecencyFallback?: boolean;
  /**
   * When papers carry a `semanticRelevance` score (set by the semantic filter),
   * drop every candidate scoring BELOW this cosine threshold before ranking.
   * Papers without a `semanticRelevance` value are treated as the lexical-only
   * fallback and are never dropped on this axis.
   */
  semanticThreshold?: number;
  /**
   * Floor on how many semantic-passing papers the shortlist keeps. The drop
   * only applies when at least this many papers clear `semanticThreshold`;
   * otherwise the best semantic candidates are kept so synthesis still has
   * material (never drop below this unless fewer papers pass). Default 4.
   */
  minSemanticCount?: number;
}

/**
 * Select the shortlist: top `max(minCount, ceil(n/4))` by relevance score,
 * clamped to `maxCount` when given. `max(2, top-quartile)` floor prevents the
 * quartile rule from evaporating on tiny result sets. Recency fallback kicks in
 * only when best score is very low. When `minInternational` is set, the result
 * is guaranteed to include at least that many international journals (swapping
 * out the lowest-relevance non-international entries) as long as the pool has
 * enough of them.
 */
export function selectShortlist<T extends ScoringPaper>(
  papers: T[],
  terms: string[],
  opts: ShortlistOptions = {}
): T[] {
  const minCount = opts.minCount ?? 2;
  const maxCount = opts.maxCount;
  const minInternational = opts.minInternational ?? 0;
  const useRecencyFallback = opts.useRecencyFallback ?? true;
  if (papers.length === 0) return [];

  // Semantic drop: when candidates carry a `semanticRelevance` score, discard
  // the off-topic ones (below threshold) BEFORE lexical ranking so irrelevant
  // polysemous matches (e.g. "aktor" the IR agent vs. "aktor" the performer)
  // never reach synthesis. The floor guarantees we never starve synthesis: the
  // drop applies only when enough papers clear the threshold, otherwise we keep
  // what passed (or fall back to all papers when none carry a score at all).
  const semanticThreshold = opts.semanticThreshold;
  const minSemanticCount = opts.minSemanticCount ?? 4;
  let pool = papers;
  if (semanticThreshold !== undefined) {
    const scored = papers.filter((p) => typeof p.semanticRelevance === "number");
    if (scored.length > 0) {
      const passing = papers.filter(
        (p) =>
          typeof p.semanticRelevance === "number" &&
          p.semanticRelevance >= semanticThreshold
      );
      pool = passing.length >= minSemanticCount ? passing : passing.length > 0 ? passing : papers;
    }
  }

  const maxCitations = pool.reduce((m, p) => Math.max(m, p.citationCount), 0);
  const scored = pool.map((p) => ({
    p,
    score: relevanceScore(p, terms, { maxCitations }),
  }));
  scored.sort((a, b) => b.score - a.score);

  const cap = maxCount && maxCount >= minCount ? maxCount : undefined;
  const k = Math.min(
    cap ?? Number.MAX_SAFE_INTEGER,
    Math.max(minCount, Math.ceil(pool.length / 4)),
  );
  let top = scored.slice(0, k);

  const best = top[0]?.score ?? 0;
  if (useRecencyFallback && best < 0.15 && pool.length > k) {
    const byRecency = [...pool]
      .sort((a, b) => b.year - a.year)
      .slice(0, minCount);
    const seen = new Set(byRecency.map((p) => p.title));
    for (const item of top) if (!seen.has(item.p.title)) byRecency.push(item.p);
    top = byRecency.slice(0, k).map((p) => ({ p, score: relevanceScore(p, terms, { maxCitations }) }));
  }

  const list = top.map((s) => s.p);
  if (minInternational > 0) {
    const hasIntl = (p: T) => isInternationalJournal(p);
    let intlCount = list.filter(hasIntl).length;
    if (intlCount < minInternational) {
      const needed = minInternational - intlCount;
      const candidates = scored
        .slice(k)
        .map((s) => s.p)
        .filter((p) => hasIntl(p) && !list.includes(p));
      let added = 0;
      for (const cp of candidates) {
        if (added >= needed) break;
        // Replace the lowest-relevance non-international entry so the quota is
        // met without growing the list past the relevance-ranked top-k.
        let worstIdx = -1;
        let worstScore = Infinity;
        for (let i = 0; i < list.length; i++) {
          if (!hasIntl(list[i]) && top[i] && top[i].score < worstScore) {
            worstScore = top[i].score;
            worstIdx = i;
          }
        }
        if (worstIdx === -1) break;
        list[worstIdx] = cp;
        added++;
        intlCount++;
      }
    }
  }

  return list;
}

// ---------------------------------------------------------------------------
// Approval-gate defaults (Change 2)
//
// The human approval gate before synthesis STAYS — it is the primary defence
// against hallucinated/irrelevant theory (Risk Register R2/R3, Medium-High
// impact). What follows only reduces its friction: it decides which candidates
// arrive pre-checked, so the student overrides a sensible default instead of
// hand-picking from zero.
//
// Pure and client-safe on purpose: `app/components/PaperReview.tsx` imports
// this directly (legal per ARCHITECTURE §2 — scoring.ts touches no DB/env/fs).
// ---------------------------------------------------------------------------

/** The minimum a candidate must carry to be pre-approved. */
export interface ApprovalCandidate {
  relevanceScore: number;
  citationCount: number;
}

/** Absolute floor on how many candidates arrive pre-checked. */
export const APPROVAL_MIN_COUNT = 2;

/**
 * Which candidates clear the retrieval heuristic well enough to be checked by
 * default.
 *
 * Batch-relative by design, mirroring `selectShortlist`'s existing
 * `max(minCount, top-quartile)` rule rather than inventing a fresh magic
 * constant: a paper is pre-checked if its relevance reaches the batch's
 * top-quartile relevance, and the top `APPROVAL_MIN_COUNT` are always included
 * so a uniformly weak batch still proposes something to review instead of
 * presenting an all-unchecked list the student must fill in by hand.
 *
 * Ties are kept together: papers scoring exactly at the cut all pass, so two
 * identically-scored papers can never be split by array order.
 *
 * Returns the indices that should start checked — indices, not objects, so the
 * caller maps back to its own ids without this module knowing about them.
 */
export function defaultApprovedIndices(
  papers: ApprovalCandidate[],
  opts: { minCount?: number } = {},
): number[] {
  const minCount = opts.minCount ?? APPROVAL_MIN_COUNT;
  if (papers.length === 0) return [];

  const order = papers
    .map((p, i) => ({ i, score: p.relevanceScore, citations: p.citationCount }))
    // Relevance first; citation count breaks ties (the citation signal is
    // already folded into relevanceScore, so it only arbitrates here).
    .sort((a, b) => b.score - a.score || b.citations - a.citations);

  const quartileCut = Math.max(minCount, Math.ceil(papers.length / 4));
  const cutScore = order[Math.min(quartileCut, order.length) - 1].score;

  const passing = order.filter((o) => o.score >= cutScore).map((o) => o.i);
  // Guarantee the floor even if scores are degenerate (e.g. every score 0).
  if (passing.length >= Math.min(minCount, papers.length)) return passing.sort((a, b) => a - b);
  return order
    .slice(0, Math.min(minCount, papers.length))
    .map((o) => o.i)
    .sort((a, b) => a - b);
}
