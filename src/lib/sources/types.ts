// Unified scholarly-source layer for so-study.
//
// Each external index (OpenAlex, Crossref, Semantic Scholar, PubMed) implements
// `SourceProvider.search()` and returns `SourcePaper[]` in a common shape. The
// aggregator (src/lib/sources/index.ts) runs them in parallel, deduplicates by
// DOI, merges metadata, enriches citations (./citations), and re-scores with
// scoring.ts.
//
// Why a common shape + one fan-out point: the gap analysis (ROADMAP §15, gap B)
// flagged single-source (OpenAlex) coverage as a weakness, and source breadth
// is what makes grounding (src/lib/grounding.ts) and APA citations
// (src/lib/citation.ts) trustworthy. One merge/dedupe location keeps it tested
// in a single place.

export type PaperType = "article" | "book" | "preprint" | "other";

export interface SourcePaper {
  title: string;
  /** Human display string, e.g. "Jane Doe, John Smith". */
  authors: string;
  year: number;
  abstract: string;
  /** Canonical link: https://doi.org/<doi> when a DOI exists, else provider URL. */
  sourceUrl: string;
  citationCount: number;
  /** Set centrally by the aggregator via scoring.selectShortlist; providers send 0. */
  relevanceScore: number;
  /**
   * Dense cosine similarity between the module TITLE and this paper's
   * `title + abstract` (scoring.semanticRelevance). Stamped by the aggregator
   * only when the semantic filter runs; absent on the lexical-only /
   * embedding-failure fallback path. Consumed by selectShortlist's off-topic
   * drop and by retrieveSources' fused ranking (P2).
   */
  semanticRelevance?: number;
  fullTextAvailable: boolean;
  doi?: string;
  venue?: string; // journal title, or publisher for books
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  provider: string; // "openalex" | "crossref" | "semanticscholar" | "pubmed" | "doaj"
  type?: PaperType;
  /**
   * ISO-639-1 language code of the work ("id" | "en" | "fr" | …), lowercased.
   * Only providers that know it set it (DOAJ); others leave it undefined. Used
   * by scoring.ts to nudge the shortlist toward the student's primary languages
   * (Indonesian + English) without excluding other-language sources.
   */
  language?: string;
}

/** Languages the student reads primarily — surfaced/boosted by retrieval. */
export const PREFERRED_LANGUAGES = ["id", "en"] as const;

export interface RetrieveOptions {
  yearMin?: number;
  perTopic?: number;
  cache?: boolean;
  /** Jurusan; appended to provider queries for disciplinary bias. */
  major?: string;
  /**
   * Concise terms for relevance ranking. When omitted, the aggregator derives
   * them from the query + keywords. Kept separate from the (expanded) search
   * keywords so a broad query does not dilute every paper's overlap score.
   */
  scoringTerms?: string[];
}

export interface SourceProvider {
  name: string;
  search(query: string, keywords: string[], opts: RetrieveOptions): Promise<SourcePaper[]>;
}

/** Normalize any DOI spelling to the bare `10.xxxx/...` form, or null. */
export function normalizeDoi(raw?: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/10\.\d{4,9}\/[^\s)]+/i);
  if (!m) return null;
  const doi = m[0].replace(/[.;,)\]]+$/, "").toLowerCase();
  return doi.length >= 7 ? doi : null;
}

/** DOI → https://doi.org/... (or null). */
export function doiUrl(doi?: string | null): string | null {
  const n = normalizeDoi(doi);
  return n ? `https://doi.org/${n}` : null;
}

function normTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Crossref carries the most complete bibliographic record, so when several
// providers return the same work we prefer its venue/volume/pages.
const PROVIDER_PRIORITY = ["crossref", "openalex", "semanticscholar", "pubmed"];

function firstDefined<T>(...vals: (T | undefined)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}

/**
 * Group papers by DOI (fallback: normalized title) and merge so the result is
 * one record per real work with the richest metadata. Never throws; pure.
 */
export function dedupeAndMerge(papers: SourcePaper[]): SourcePaper[] {
  const groups = new Map<string, SourcePaper[]>();
  for (const p of papers) {
    const key = normalizeDoi(p.doi) ?? `t:${normTitle(p.title)}`;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }

  const out: SourcePaper[] = [];
  for (const arr of groups.values()) {
    arr.sort(
      (a, b) => PROVIDER_PRIORITY.indexOf(a.provider) - PROVIDER_PRIORITY.indexOf(b.provider)
    );
    const base: SourcePaper = { ...arr[0], relevanceScore: 0 };
    for (const p of arr) {
      base.authors = firstDefined(p.authors, base.authors) ?? base.authors;
      base.abstract = firstDefined(p.abstract, base.abstract) ?? base.abstract;
      base.venue = firstDefined(p.venue, base.venue) ?? base.venue;
      base.volume = firstDefined(p.volume, base.volume) ?? base.volume;
      base.issue = firstDefined(p.issue, base.issue) ?? base.issue;
      base.pages = firstDefined(p.pages, base.pages) ?? base.pages;
      base.publisher = firstDefined(p.publisher, base.publisher) ?? base.publisher;
      base.citationCount = Math.max(base.citationCount, p.citationCount);
      base.fullTextAvailable = base.fullTextAvailable || p.fullTextAvailable;
      base.year = base.year || p.year;
      base.type = base.type ?? p.type;
      // Keep the first non-undefined language so a DOAJ-tagged work keeps its
      // language even if a cross-ref provider in the same group left it blank.
      if (base.language === undefined && p.language !== undefined) base.language = p.language;
      const doi = normalizeDoi(p.doi) ?? normalizeDoi(base.doi);
      if (doi) {
        base.doi = doi;
        base.sourceUrl = doiUrl(doi) as string;
      }
    }
    base.provider = Array.from(new Set(arr.map((p) => p.provider))).join("+");
    out.push(base);
  }
  return out;
}
