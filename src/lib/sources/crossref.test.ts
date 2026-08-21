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

import { crossrefProvider } from "./crossref";

function mockFetchOnce(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ ok, status, json: async () => body }));
}

const CROSSREF_ITEM = {
  DOI: "10.1000/abc",
  title: ["Sample Title"],
  author: [
    { given: "Jane", family: "Doe" },
    { given: "John", family: "Smith" },
  ],
  issued: { "date-parts": [[2021]] },
  abstract: "<p>An <b>abstract</b> with markup.</p>",
  "is-referenced-by-count": 42,
  "container-title": ["Journal of Tests"],
  volume: "3",
  issue: "2",
  page: "100-110",
  publisher: "Test Pub",
  type: "journal-article",
};

beforeEach(() => {
  readFile.mockReset();
  writeFile.mockReset();
  mkdir.mockReset();
  // Default: cache miss.
  readFile.mockRejectedValue(new Error("ENOENT"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("crossrefProvider", () => {
  it("maps fields from a Crossref response", async () => {
    const fetchMock = mockFetchOnce({ message: { items: [CROSSREF_ITEM] } });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const papers = await crossrefProvider.search("query", ["kw"], { perTopic: 10 });

    expect(papers).toHaveLength(1);
    const p = papers[0];
    expect(p.title).toBe("Sample Title");
    expect(p.authors).toBe("Jane Doe, John Smith");
    expect(p.year).toBe(2021);
    expect(p.abstract).toBe(" An  abstract  with markup. ");
    expect(p.doi).toBe("10.1000/abc");
    expect(p.sourceUrl).toBe("https://doi.org/10.1000/abc");
    expect(p.citationCount).toBe(42);
    expect(p.venue).toBe("Journal of Tests");
    expect(p.volume).toBe("3");
    expect(p.issue).toBe("2");
    expect(p.pages).toBe("100-110");
    expect(p.publisher).toBe("Test Pub");
    expect(p.provider).toBe("crossref");
    expect(p.type).toBe("article");
    expect(p.relevanceScore).toBe(0);
    expect(p.fullTextAvailable).toBe(false);
  });

  it("maps book / preprint types correctly", async () => {
    const fetchMock = mockFetchOnce({
      message: {
        items: [{ ...CROSSREF_ITEM, type: "book" }, { ...CROSSREF_ITEM, type: "posted-content" }],
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const papers = await crossrefProvider.search("q", [], { cache: false });
    expect(papers[0].type).toBe("book");
    expect(papers[1].type).toBe("preprint");
  });

  it("returns [] on fetch/JSON failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const papers = await crossrefProvider.search("q", [], { cache: false });
    expect(papers).toEqual([]);
  });

  it("writes cache on miss and reads cache on hit", async () => {
    const fetchMock = mockFetchOnce({ message: { items: [CROSSREF_ITEM] } });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const first = await crossrefProvider.search("cacheme", [], { cache: true });
    expect(first).toHaveLength(1);
    expect(writeFile).toHaveBeenCalledTimes(1);

    // Second call: cache hit, fetch not called again.
    fetchMock.mockClear();
    readFile.mockResolvedValue(JSON.stringify([CROSSREF_ITEM]));
    const second = await crossrefProvider.search("cacheme", [], { cache: true });
    expect(second).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds query including major and skips cache when cache=false", async () => {
    const fetchMock = mockFetchOnce({ message: { items: [] } });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );
    await crossrefProvider.search("query", ["kw"], { major: "physics", cache: false });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(url)).toContain("query kw physics");
    expect(writeFile).not.toHaveBeenCalled();
  });
});
