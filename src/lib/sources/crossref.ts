import fs from "fs/promises";
import path from "path";
import { SourcePaper, SourceProvider, RetrieveOptions, doiUrl } from "./types";

interface CrossrefAuthor {
  given?: string;
  family?: string;
}

interface CrossrefItem {
  title?: string[];
  author?: CrossrefAuthor[];
  issued?: { "date-parts"?: number[][] };
  published?: { "date-parts"?: number[][] };
  abstract?: string;
  DOI?: string;
  "is-referenced-by-count"?: number;
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  type?: string;
}

const CACHE_DIR = path.join(process.cwd(), ".cache", "sources", "crossref");

function cacheKey(q: string): string {
  const slug = q
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

function mapType(t: string | undefined): SourcePaper["type"] {
  switch (t) {
    case "book":
    case "monograph":
      return "book";
    case "journal-article":
    case "proceedings-article":
      return "article";
    case "posted-content":
      return "preprint";
    default:
      return "other";
  }
}

export const crossrefProvider: SourceProvider = {
  name: "crossref",
  async search(query: string, keywords: string[], opts: RetrieveOptions): Promise<SourcePaper[]> {
    try {
      const q = [query, ...keywords, opts.major].filter(Boolean).join(" ");
      const key = cacheKey(q);

      if (opts.cache !== false) {
        const cached = await readCache(key);
        if (cached) return cached;
      }

      const url =
        `https://api.crossref.org/works?query=${encodeURIComponent(q)}` +
        `&rows=${opts.perTopic ?? 15}` +
        `&select=DOI,title,author,issued,published,is-referenced-by-count,container-title,volume,issue,page,publisher,type` +
        `&filter=from-pub-date:${(opts.yearMin ?? 1970)}-01-01` +
        `&mailto=so-study+local@example.com`;

      const res = await fetch(url);
      if (!res.ok) return [];
      const json = (await res.json()) as { message?: { items?: CrossrefItem[] } };
      const items = json.message?.items ?? [];

      const papers: SourcePaper[] = items.map((item) => {
        const doi = item.DOI;
        return {
          title: item.title?.[0] ?? "",
          authors:
            item.author
              ?.map((a) => [a.given, a.family].filter(Boolean).join(" "))
              .join(", ") ?? "",
          year:
            item.issued?.["date-parts"]?.[0]?.[0] ??
            item.published?.["date-parts"]?.[0]?.[0] ??
            0,
          abstract: (item.abstract ?? "").replace(/<[^>]+>/g, " "),
          sourceUrl: doiUrl(doi) ?? `https://doi.org/${doi}`,
          citationCount: item["is-referenced-by-count"] ?? 0,
          relevanceScore: 0,
          fullTextAvailable: false,
          doi,
          venue: item["container-title"]?.[0],
          volume: item.volume,
          issue: item.issue,
          pages: item.page,
          publisher: item.publisher,
          provider: "crossref",
          type: mapType(item.type),
        };
      });

      if (opts.cache !== false) await writeCache(key, papers);
      return papers;
    } catch {
      return [];
    }
  },
};
