import fs from "fs/promises";
import path from "path";
import { SourcePaper, SourceProvider, RetrieveOptions, doiUrl } from "./types";

interface PubMedArticleId {
  idtype?: string;
  value?: string;
}

interface PubMedAuthor {
  name?: string;
}

interface PubMedSummary {
  title?: string;
  pubdate?: string;
  source?: string;
  fulljournalname?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  authors?: PubMedAuthor[];
  articleids?: PubMedArticleId[];
}

const CACHE_DIR = path.join(process.cwd(), ".cache", "sources", "pubmed");

function cacheKey(q: string, opts: { yearMin?: number; perTopic?: number; major?: string }): string {
  const parts = [q, String(opts.yearMin ?? 1970), String(opts.perTopic ?? 15), opts.major ?? ""]
    .filter(Boolean)
    .join("_");
  const slug = parts
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 200);
  return `${slug}.json`;
}

async function readCache(key: string): Promise<SourcePaper[] | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, key), "utf8");
    return JSON.parse(raw) as SourcePaper[];
  } catch {
    return null;
  }
}

async function writeCache(key: string, papers: SourcePaper[]): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, key), JSON.stringify(papers, null, 2));
  } catch {
    // Best-effort cache; ignore write failures.
  }
}

function parseYear(pubdate?: string): number {
  const m = (pubdate ?? "").match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : 0;
}

export const pubMedProvider: SourceProvider = {
  name: "pubmed",
  async search(query: string, keywords: string[], opts: RetrieveOptions, signal?: AbortSignal): Promise<SourcePaper[]> {
    try {
      const q = [query, ...keywords, opts.major].filter(Boolean).join(" ");
      const key = cacheKey(q, { yearMin: opts.yearMin, perTopic: opts.perTopic, major: opts.major });

      if (opts.cache !== false) {
        const cached = await readCache(key);
        if (cached) return cached;
      }

      const esearchUrl =
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed` +
        `&term=${encodeURIComponent(q)}` +
        `&retmode=json` +
        `&retmax=${opts.perTopic ?? 15}` +
        `&datetype=pdat` +
        `&mindate=${opts.yearMin ?? 1970}` +
        `&maxdate=3000`;

      const esearchRes = await fetch(esearchUrl, { signal });
      if (!esearchRes.ok) return [];
      const esearchJson = (await esearchRes.json()) as {
        esearchresult?: { idlist?: string[] };
      };
      const ids = esearchJson.esearchresult?.idlist ?? [];
      if (ids.length === 0) {
        if (opts.cache !== false) await writeCache(key, []);
        return [];
      }

      const esummaryUrl =
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed` +
        `&id=${ids.join(",")}` +
        `&retmode=json`;

      const esummaryRes = await fetch(esummaryUrl, { signal });
      if (!esummaryRes.ok) return [];
      const esummaryJson = (await esummaryRes.json()) as { result?: Record<string, PubMedSummary> };
      const result = esummaryJson.result ?? {};

      const papers: SourcePaper[] = [];
      for (const id of ids) {
        const r = result[id];
        if (!r) continue;
        const doi = r.articleids?.find((a) => a.idtype === "doi")?.value;
        papers.push({
          title: r.title ?? "",
          authors: r.authors?.map((a) => a.name).join(", ") ?? "",
          year: parseYear(r.pubdate),
          abstract: "",
          sourceUrl: doiUrl(doi) ?? `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
          citationCount: 0,
          relevanceScore: 0,
          fullTextAvailable: false,
          doi,
          venue: r.source ?? r.fulljournalname,
          volume: r.volume,
          issue: r.issue,
          pages: r.pages,
          provider: "pubmed",
          type: "article",
        });
      }

      if (opts.cache !== false) await writeCache(key, papers);
      return papers;
    } catch {
      return [];
    }
  },
};
