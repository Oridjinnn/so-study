import { SourcePaper } from "./types";

const FETCH_TIMEOUT_MS = 6000;
const CONCURRENCY = 5;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), FETCH_TIMEOUT_MS)),
  ]);
}

async function fetchCoci(doi: string): Promise<number> {
  const url = `https://opencitations.net/api/v1/citations/${encodeURIComponent(doi)}`;
  const res = await withTimeout(fetch(url));
  if (!res.ok) return 0;
  const data = (await res.json()) as unknown[];
  return Array.isArray(data) ? data.length : 0;
}

async function fetchScite(doi: string): Promise<number> {
  const apiKey = process.env.SCITE_API_KEY;
  if (!apiKey) return 0;
  try {
    const url = `https://api.scite.ai/v1/doi/${encodeURIComponent(doi)}`;
    const res = await withTimeout(
      fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as {
      citations?: { supporting?: number; contrasting?: number };
    };
    const citing = data?.citations;
    if (citing) {
      return (citing.supporting ?? 0) + (citing.contrasting ?? 0);
    }
    return 0;
  } catch {
    return 0;
  }
}

async function enrichOne(paper: SourcePaper): Promise<SourcePaper> {
  if (!paper.doi) return paper;
  let count = paper.citationCount ?? 0;
  try {
    const coci = await fetchCoci(paper.doi);
    if ((paper.citationCount ?? 0) === 0 && coci > 0) {
      count = coci;
    }
  } catch {
    // COCI failure: keep existing count.
  }

  try {
    const scite = await fetchScite(paper.doi);
    if (scite > count) count = scite;
  } catch {
    // Scite failure: keep existing count.
  }

  return { ...paper, citationCount: count };
}

/**
 * Best-effort, never-throwing citation enrichment. For each paper with a DOI,
 * pulls OpenCitations COCI citing counts (and optionally Scite when
 * SCITE_API_KEY is configured), raising a zero/missing citationCount. Returns
 * the (possibly mutated) array, or the original on total failure.
 */
export async function enrichCitations(papers: SourcePaper[]): Promise<SourcePaper[]> {
  try {
    const out: SourcePaper[] = new Array(papers.length);
    let cursor = 0;

    async function worker(): Promise<void> {
      while (cursor < papers.length) {
        const i = cursor++;
        out[i] = await enrichOne(papers[i]);
      }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
    await Promise.all(workers);

    return out;
  } catch {
    return papers;
  }
}
