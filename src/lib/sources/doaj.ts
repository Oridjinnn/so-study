// DOAJ (Directory of Open Access Journals) retrieval as a SourceProvider.
//
// DOAJ is a free, key-less index of peer-reviewed open-access journals. It is
// the single richest free source of Indonesian-language scholarly works (the
// jurusan's primary language) alongside English and other languages, so adding
// it directly answers the "sumber masih terbatas pada bahasa internasional"
// gap: OpenAlex/Crossref/Semantic Scholar are English/international-dominant,
// while DOAJ surfaces Indonesian journals (many of which also mirror into
// Garba Rujukan Digital) the student can actually read.
//
// The API returns a `language` field per article, which we surface so scoring
// can nudge the shortlist toward the student's primary languages without
// excluding other-language sources. Mirrors the cache + degrade-to-[] contract
// used by the other providers (src/lib/sources/index.ts).

import fs from "fs/promises";
import path from "path";
import { doiUrl, SourcePaper, SourceProvider, RetrieveOptions, PaperType } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache", "sources", "doaj");

// DOAJ's API is public but asks for a polite contact; we identify locally.
const MAILTO = "so-study+local@example.com";

interface DoajLink {
  url?: string;
  type?: string;
}

interface DoajIdentifier {
  type?: string;
  id?: string;
}

interface DoajAuthor {
  name?: string;
}

interface DoajBibjson {
  title?: string;
  author?: DoajAuthor[];
  year?: string | number;
  abstract?: string[];
  language?: string[];
  identifier?: DoajIdentifier[];
  link?: DoajLink[];
  journal?: { title?: string; publisher?: string; volume?: string; number?: string };
  start_page?: string;
  end_page?: string;
}

interface DoajItem {
  bibjson?: DoajBibjson;
}

interface DoajResponse {
  results?: DoajItem[];
}

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

function normalizeLanguage(langs?: string[]): string | undefined {
  if (!langs || langs.length === 0) return undefined;
  // DOAJ uses ISO-639-1 codes ("ID", "EN", "FR", …); lowercase + take first.
  const code = langs[0].trim().toLowerCase();
  return code.length >= 2 ? code.slice(0, 2) : undefined;
}

export const doajProvider: SourceProvider = {
  name: "doaj",
  async search(query: string, keywords: string[], opts: RetrieveOptions): Promise<SourcePaper[]> {
    try {
      const q = [query, ...keywords, opts.major].filter(Boolean).join(" ");
      const key = cacheKey(q);

      if (opts.cache !== false) {
        const cached = await readCache(key);
        if (cached) return cached;
      }

      // DOAJ v2 search: free-text query, page size capped. The index is
      // open-access-first, which is exactly what we want for study sources a
      // student can actually open.
      const url =
        `https://doaj.org/api/v2/search/articles/${encodeURIComponent(q)}` +
        `?pageSize=${Math.min(opts.perTopic ?? 15, 20)}` +
        `&mailto=${MAILTO}`;

      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return [];
      const json = (await res.json()) as DoajResponse;
      const items = json.results ?? [];

      const papers: SourcePaper[] = items
        .map((item) => {
          const b = item.bibjson;
          if (!b) return null;
          const doi = b.identifier?.find((i) => (i.type ?? "").toLowerCase() === "doi")?.id;
          const links = b.link ?? [];
          const fullLink = links.find((l) => (l.type ?? "").toLowerCase() === "fulltext")?.url;
          const anyLink = links[0]?.url;
          const sourceUrl = doiUrl(doi) ?? fullLink ?? anyLink ?? "";
          if (!sourceUrl) return null;
          const abstract = (b.abstract ?? []).join(" ").trim();
          const year = Number(b.year ?? 0) || 0;
          const lang = normalizeLanguage(b.language);
          const authors = (b.author ?? [])
            .map((a) => a.name ?? "")
            .filter(Boolean)
            .join(", ");
          const venue = b.journal?.title;
          const pages = b.start_page && b.end_page ? `${b.start_page}-${b.end_page}` : undefined;
          const paper: SourcePaper = {
            title: b.title ?? "",
            authors,
            year,
            abstract,
            sourceUrl,
            citationCount: 0,
            relevanceScore: 0,
            fullTextAvailable: Boolean(fullLink),
            doi,
            venue,
            volume: b.journal?.volume,
            issue: b.journal?.number,
            pages,
            publisher: b.journal?.publisher,
            provider: "doaj",
            type: "article" as PaperType,
            language: lang,
          };
          return paper.title.length > 0 ? paper : null;
        })
        .filter((p): p is SourcePaper => p !== null);

      if (opts.cache !== false) await writeCache(key, papers);
      return papers;
    } catch {
      return [];
    }
  },
};

export default doajProvider;
