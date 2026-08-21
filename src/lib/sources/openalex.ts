// OpenAlex retrieval (heuristic, no LLM) as a SourceProvider, with local
// response caching for backward compatibility with the old `src/lib/openalex.ts`.
// The aggregator (src/lib/sources/index.ts) runs this alongside other providers,
// deduplicates by DOI, and re-scores centrally.

import { promises as fs } from "fs";
import path from "path";
import { doiUrl, PaperType, SourcePaper, SourceProvider } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache", "openalex");
const MAILTO = "so-study+local@example.com";

interface OpenAlexAuthor {
  author?: { display_name?: string };
}

interface OpenAlexWork {
  display_name?: string;
  title?: string;
  abstract_inverted_index?: Record<string, number[]>;
  publication_year?: number;
  cited_by_count?: number;
  doi?: string;
  id?: string;
  open_access?: { is_oa?: boolean };
  authorships?: OpenAlexAuthor[];
  type?: string;
  primary_location?: {
    source?: {
      display_name?: string;
      host_organization_name?: string;
    };
  };
  biblio?: {
    volume?: string;
    issue?: string;
    first_page?: string;
    last_page?: string;
  };
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
}

function cacheKey(query: string, keywords: string[], major?: string): string {
  const slug = `${query}__${keywords.join(",")}__${major ?? ""}`
    .replace(/[^a-z0-9]/gi, "_")
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
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, key), JSON.stringify(papers, null, 2));
}

function mapType(t?: string): PaperType {
  switch (t) {
    case "article":
    case "peer_review":
    case "proceedings":
      return "article";
    case "book":
    case "monograph":
      return "book";
    case "preprint":
      return "preprint";
    default:
      return "other";
  }
}

// OpenAlex stores abstracts as an inverted index; rebuild plain text.
function reconstruct(idx: Record<string, number[]>): string {
  const out: string[] = [];
  for (const [word, positions] of Object.entries(idx)) {
    for (const pos of positions) out[pos] = word;
  }
  return out.filter(Boolean).join(" ");
}

function mapWork(r: OpenAlexWork): SourcePaper {
  const doi = r.doi ?? undefined;
  const sourceUrl = doiUrl(doi) ?? r.id ?? "";
  const volume = r.biblio?.volume ?? undefined;
  const issue = r.biblio?.issue ?? undefined;
  const pages =
    r.biblio?.first_page && r.biblio?.last_page
      ? `${r.biblio.first_page}-${r.biblio.last_page}`
      : undefined;

  return {
    title: r.display_name ?? r.title ?? "",
    authors: (r.authorships ?? [])
      .map((a) => a.author?.display_name)
      .filter((name): name is string => Boolean(name))
      .join(", "),
    year: r.publication_year ?? 0,
    abstract: r.abstract_inverted_index ? reconstruct(r.abstract_inverted_index) : "",
    sourceUrl,
    citationCount: r.cited_by_count ?? 0,
    relevanceScore: 0,
    fullTextAvailable: Boolean(r.open_access?.is_oa),
    doi,
    venue: r.primary_location?.source?.display_name ?? undefined,
    volume,
    issue,
    pages,
    publisher: r.primary_location?.source?.host_organization_name ?? undefined,
    type: mapType(r.type),
    provider: "openalex",
  };
}

async function search(
  query: string,
  keywords: string[] = [],
  opts: { yearMin?: number; perTopic?: number; cache?: boolean; major?: string } = {},
): Promise<SourcePaper[]> {
  const yearMin = opts.yearMin ?? 1970;
  const perTopic = opts.perTopic ?? 15;
  const major = opts.major?.trim() || undefined;
  const key = cacheKey(query, keywords, major);

  if (opts.cache !== false) {
    const cached = await readCache(key);
    if (cached) return cached;
  }

  // The major joins the free-text `search` term (which is what actually biases
  // which works OpenAlex returns). It is deliberately NOT added to any scoring
  // terms (scoring is central), so an Indonesian jurusan label would not distort
  // relevance heuristics.
  const searchTerm = [query, ...keywords, major].filter(Boolean).join(" ");
  const url =
    `https://api.openalex.org/works?search=${encodeURIComponent(searchTerm)}` +
    `&filter=from_publication_date:${yearMin}-01-01` +
    `&per-page=${perTopic}&sort=relevance_score:desc` +
    `&mailto=${MAILTO}`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": "anthro-study/0.1" } });
    if (!res.ok) return [];
    const json = (await res.json()) as OpenAlexResponse;
    const papers = (json.results ?? []).map(mapWork);
    if (opts.cache !== false) await writeCache(key, papers);
    return papers;
  } catch {
    return [];
  }
}

export const openAlexProvider: SourceProvider = {
  name: "openalex",
  search,
};

export default openAlexProvider;
