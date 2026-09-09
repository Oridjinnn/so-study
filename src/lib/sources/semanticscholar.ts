import fs from "fs/promises";
import path from "path";
import { SourcePaper, SourceProvider, RetrieveOptions, doiUrl } from "./types";

interface S2Author {
  firstName?: string;
  lastName?: string;
}

interface S2Item {
  title?: string;
  year?: number;
  abstract?: string;
  authors?: S2Author[];
  citationCount?: number;
  externalIds?: { DOI?: string };
  venue?: string;
  publicationTypes?: string[];
  openAccessPdf?: { url?: string };
  url?: string;
  source?: string;
}

const CACHE_DIR = path.join(process.cwd(), ".cache", "sources", "semanticscholar");

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

export const semanticScholarProvider: SourceProvider = {
  name: "semanticscholar",
  async search(query: string, keywords: string[], opts: RetrieveOptions, signal?: AbortSignal): Promise<SourcePaper[]> {
    try {
      const q = [query, ...keywords, opts.major].filter(Boolean).join(" ");
      const key = cacheKey(q, { yearMin: opts.yearMin, perTopic: opts.perTopic, major: opts.major });

      if (opts.cache !== false) {
        const cached = await readCache(key);
        if (cached) return cached;
      }

      const yearMin = opts.yearMin ?? 1970;
      const url =
        `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(q)}` +
        `&limit=${opts.perTopic ?? 15}` +
        `&fields=title,year,abstract,authors,citationCount,externalIds,venue,publicationTypes,openAccessPdf,source`;

      const res = await fetch(url, { signal });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: S2Item[] };
      const items = json.data ?? [];

      const papers: SourcePaper[] = [];
      for (const item of items) {
        const year = item.year ?? 0;
        if (year < yearMin) continue;
        const doi = item.externalIds?.DOI;
        const type: SourcePaper["type"] =
          Array.isArray(item.publicationTypes) && item.publicationTypes.includes("Preprint")
            ? "preprint"
            : item.source === "Preprint"
              ? "preprint"
              : "article";
        papers.push({
          title: item.title ?? "",
          authors:
            item.authors
              ?.map((a) => [a.firstName, a.lastName].filter(Boolean).join(" "))
              .join(", ") ?? "",
          year,
          abstract: item.abstract ?? "",
          sourceUrl:
            doiUrl(doi) ??
            item.openAccessPdf?.url ??
            item.url ??
            "",
          citationCount: item.citationCount ?? 0,
          relevanceScore: 0,
          fullTextAvailable: Boolean(item.openAccessPdf?.url),
          doi,
          venue: item.venue,
          provider: "semanticscholar",
          type,
        });
      }

      if (opts.cache !== false) await writeCache(key, papers);
      return papers;
    } catch {
      return [];
    }
  },
};
