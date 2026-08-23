// Pure, deterministic heuristic scoring for paper retrieval.
// No LLM, no IO — unit-tested in scoring.test.ts.

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

  const maxCitations = papers.reduce((m, p) => Math.max(m, p.citationCount), 0);
  const scored = papers.map((p) => ({
    p,
    score: relevanceScore(p, terms, { maxCitations }),
  }));
  scored.sort((a, b) => b.score - a.score);

  const cap = maxCount && maxCount >= minCount ? maxCount : undefined;
  const k = Math.min(
    cap ?? Number.MAX_SAFE_INTEGER,
    Math.max(minCount, Math.ceil(papers.length / 4)),
  );
  let top = scored.slice(0, k);

  const best = top[0]?.score ?? 0;
  if (useRecencyFallback && best < 0.15 && papers.length > k) {
    const byRecency = [...papers]
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
