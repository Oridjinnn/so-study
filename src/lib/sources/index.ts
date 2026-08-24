// Source aggregator — the single fan-out point for multi-provider retrieval.
//
// Each provider (OpenAlex, Crossref, Semantic Scholar, PubMed) implements
// `SourceProvider.search()` in ./types. This module runs them all in parallel,
// deduplicates/merges by DOI (dedupeAndMerge), enriches citation counts
// (citations.enrichCitations via OpenCitations COCI), and re-scores centrally
// with scoring.ts so relevance is comparable across providers.
//
// Design: one slow or failing provider must never block the rest, so each call
// is wrapped in a timeout + .catch(() => []) and the fan-out uses
// Promise.allSettled. We only throw when EVERY provider failed (true offline),
// matching the callers' "surface the failure, never fabricate" contract.

import {
  relevanceScore,
  selectShortlist,
  internationalQuotaForMajor,
  semanticRelevance,
  titleHeuristicScore,
} from "@/src/lib/scoring";

// Cosine-similarity floor for the semantic relevance filter. Below this, a
// candidate is treated as off-topic (e.g. "aktor" the IR agent vs. the
// performer) and dropped before it can reach synthesis. Tunable.
const SEMANTIC_RELEVANCE_THRESHOLD = 0.2;
import {
  dedupeAndMerge,
  type RetrieveOptions,
  type SourcePaper,
  type SourceProvider,
} from "./types";
import { openAlexProvider } from "./openalex";
import { crossrefProvider } from "./crossref";
import { semanticScholarProvider } from "./semanticscholar";
import { pubMedProvider } from "./pubmed";
import { doajProvider } from "./doaj";
import { enrichCitations } from "./citations";

// Re-export the shared contract so callers can import everything retrieval from
// this one module (e.g. `import { retrieveSources, SourcePaper } from "…/sources"`).
export type { SourcePaper, SourceProvider, RetrieveOptions } from "./types";

// DOAJ is the Indonesian/multilingual open-access leg: it surfaces journals the
// student can actually read (many Indonesian titles), whereas the other four
// providers are English/international-dominant. It is fan-out-last so a slow
// DOAJ call never delays the core international results.
const PROVIDERS: SourceProvider[] = [
  openAlexProvider,
  crossrefProvider,
  semanticScholarProvider,
  pubMedProvider,
  doajProvider,
];

// Generous per-provider budget: a single stalled provider should not stall the
// whole retrieval, but we still want real results rather than an instant empty.
const PER_PROVIDER_TIMEOUT_MS = 9000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

/**
 * Retrieve candidate sources across all providers, deduplicated and scored.
 * Returns the shortlist (top ~quartile by relevance, min 2). Throws only when
 * no provider returned anything (offline / fully rate-limited).
 */
export async function retrieveSources(
  query: string,
  keywords: string[] = [],
  opts: RetrieveOptions = {}
): Promise<SourcePaper[]> {
  const settled = await Promise.allSettled(
    PROVIDERS.map((pr) =>
      withTimeout(pr.search(query, keywords, opts), PER_PROVIDER_TIMEOUT_MS).catch(
        () => [] as SourcePaper[]
      )
    )
  );

  const collected: SourcePaper[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") collected.push(...r.value);
  }
  if (collected.length === 0) {
    throw new Error("All source providers failed (offline or rate-limited).");
  }

  const merged = dedupeAndMerge(collected);
  const enriched = await enrichCitations(merged).catch(() => merged);

  // Semantic relevance (best-effort): embed the topic + each paper and score
  // them by cosine similarity, so polysemous/off-topic matches are dropped
  // before they can reach synthesis. On ANY embedding failure we fall back to
  // lexical-only scoring (the previous behaviour) by simply not stamping
  // `semanticRelevance`, which selectShortlist then ignores.
  let semanticallyScored: SourcePaper[] = enriched;
  try {
    const scores = await semanticRelevance(query, enriched);
    semanticallyScored = enriched.map((p, i) => ({ ...p, semanticRelevance: scores[i] }));
  } catch {
    semanticallyScored = enriched;
  }

  // Ranking terms stay concise (the caller may pass expanded search keywords);
  // a long term list would dilute every paper's overlap score toward zero.
  const terms = opts.scoringTerms?.length
    ? opts.scoringTerms
    : keywords.length
      ? keywords
      : [query];

  // P2 — the MODULE TITLE drives retrieval in ALL THREE modes, not only the
  // user's keywords. We fuse three signals into one relevance score per paper
  // and stamp it on the object so selectShortlist ranks by it (it honors a
  // pre-set relevanceScore):
  //   • keyword   — lexical overlap of the paper with `terms`. `terms` already
  //                 folds in the title's own significant tokens plus any user
  //                 keywords (see scoringTerms), so this is the keyword-match leg.
  //   • heuristic — titleHeuristicScore: overlap of the paper with the title's
  //                 OWN tokens AND bigrams (the title used as its own phrase-level
  //                 query). This is what lets a title like "Kebijakan fiskal dan
  //                 inflasi" rank a "kebijakan fiskal" paper above an unrelated
  //                 one even when the student typed no keywords.
  //   • semantic  — the dense cosine score from semanticRelevance(title, papers)
  //                 (when embeddings ran): ranks by MEANING, the leg that drops
  //                 polysemous off-topic matches. On the embedding-failure path
  //                 semanticRelevance is absent, so the fuse falls back to
  //                 keyword + heuristic only and degrades gracefully.
  // The semantic DROP still happens first inside selectShortlist (on
  // semanticRelevance), so off-topic papers never even reach this ranking.
  const maxCitations = semanticallyScored.reduce((m, p) => Math.max(m, p.citationCount), 0);
  const fused: SourcePaper[] = semanticallyScored.map((p) => {
    const kw = relevanceScore(
      { title: p.title, abstract: p.abstract, year: p.year, citationCount: p.citationCount, language: p.language },
      terms,
      { maxCitations }
    );
    const heu = titleHeuristicScore(p, query);
    const sem = typeof p.semanticRelevance === "number" ? Math.max(0, p.semanticRelevance) : undefined;
    const relevanceScoreVal =
      sem !== undefined ? 0.5 * kw + 0.2 * heu + 0.3 * sem : 0.7 * kw + 0.3 * heu;
    return { ...p, relevanceScore: Math.round(relevanceScoreVal * 1000) / 1000 };
  });

  // selectShortlist returns the SAME objects we passed in, so mapping back is a
  // direct reference walk — no id tagging needed. The review presents exactly 10
  // candidates. The international-journal quota is context-aware: only genuinely
  // international/comparative topics require 2 (see internationalQuotaForMajor);
  // domestic-literature topics (Indonesian law, local bureaucracy) keep their
  // relevant domestic papers instead of being forced to swap in lower-relevance
  // international ones.
  return selectShortlist(fused, terms, {
    minCount: 10,
    maxCount: 10,
    minInternational: internationalQuotaForMajor(opts.major),
    semanticThreshold: SEMANTIC_RELEVANCE_THRESHOLD,
  });
}
