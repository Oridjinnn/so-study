import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn<(p: string, enc: string) => Promise<string>>();
const writeFile = vi.fn<(p: string, d: string) => Promise<void>>();
const mkdir = vi.fn<() => Promise<void>>();

vi.mock("fs/promises", () => ({
  default: {
    readFile: (p: string, e: string) => readFile(p, e),
    writeFile: (p: string, d: string) => writeFile(p, d),
    mkdir: () => mkdir(),
  },
}));

import { semanticScholarProvider } from "./semanticscholar";

function mockFetchOnce(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ ok, status, json: async () => body }));
}

const S2_ITEM = {
  title: "S2 Sample",
  year: 2020,
  abstract: "An abstract.",
  authors: [
    { firstName: "Jane", lastName: "Doe" },
    { firstName: "John", lastName: "Smith" },
  ],
  citationCount: 7,
  externalIds: { DOI: "10.1000/s2" },
  venue: "S2 Journal",
  publicationTypes: ["JournalArticle"],
  openAccessPdf: { url: "https://oa.example.com/s2.pdf" },
  source: "Journal",
};

beforeEach(() => {
  readFile.mockReset();
  writeFile.mockReset();
  mkdir.mockReset();
  readFile.mockRejectedValue(new Error("ENOENT"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("semanticScholarProvider", () => {
  it("maps fields from a Semantic Scholar response", async () => {
    const fetchMock = mockFetchOnce({ data: [S2_ITEM] });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const papers = await semanticScholarProvider.search("query", ["kw"], { perTopic: 10 });

    expect(papers).toHaveLength(1);
    const p = papers[0];
    expect(p.title).toBe("S2 Sample");
    expect(p.authors).toBe("Jane Doe, John Smith");
    expect(p.year).toBe(2020);
    expect(p.abstract).toBe("An abstract.");
    expect(p.doi).toBe("10.1000/s2");
    expect(p.sourceUrl).toBe("https://doi.org/10.1000/s2");
    expect(p.citationCount).toBe(7);
    expect(p.venue).toBe("S2 Journal");
    expect(p.provider).toBe("semanticscholar");
    expect(p.type).toBe("article");
    expect(p.relevanceScore).toBe(0);
    expect(p.fullTextAvailable).toBe(true);
  });

  it("marks Preprint publicationTypes as preprint", async () => {
    const fetchMock = mockFetchOnce({ data: [{ ...S2_ITEM, publicationTypes: ["Preprint"] }] });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );
    const papers = await semanticScholarProvider.search("q", [], { cache: false });
    expect(papers[0].type).toBe("preprint");
  });

  it("drops items older than yearMin", async () => {
    const fetchMock = mockFetchOnce({ data: [{ ...S2_ITEM, year: 1990 }] });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );
    const papers = await semanticScholarProvider.search("q", [], { yearMin: 2000, cache: false });
    expect(papers).toHaveLength(0);
  });

  it("returns [] on fetch/JSON failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("boom");
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );
    const papers = await semanticScholarProvider.search("q", [], { cache: false });
    expect(papers).toEqual([]);
  });

  it("writes cache on miss and reads cache on hit", async () => {
    const fetchMock = mockFetchOnce({ data: [S2_ITEM] });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );
    const first = await semanticScholarProvider.search("cacheme", [], { cache: true });
    expect(first).toHaveLength(1);
    expect(writeFile).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    readFile.mockResolvedValue(JSON.stringify([S2_ITEM]));
    const second = await semanticScholarProvider.search("cacheme", [], { cache: true });
    expect(second).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
