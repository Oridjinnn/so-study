import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The on-disk response cache is mocked so the test can assert cache-key
// separation (the part that would silently undo the disciplinary bias) without
// writing junk into `.cache/openalex`.
const readFile = vi.fn<(path: string, enc: string) => Promise<string>>();
const writeFile = vi.fn<(path: string, data: string) => Promise<void>>();
const mkdir = vi.fn<() => Promise<void>>();

vi.mock("fs", () => ({
  promises: {
    readFile: (p: string, e: string) => readFile(p, e),
    writeFile: (p: string, d: string) => writeFile(p, d),
    mkdir: () => mkdir(),
  },
}));

import { openAlexProvider } from "./openalex";

function work(title: string, year = 2020, cited = 50) {
  return {
    display_name: title,
    abstract_inverted_index: { anthropology: [0], theory: [1], culture: [2] },
    publication_year: year,
    cited_by_count: cited,
    doi: `https://doi.org/10.1000/${title.replace(/\s+/g, "-").toLowerCase()}`,
    id: `https://openalex.org/W${cited}${year}`,
    type: "article",
    open_access: { is_oa: true },
    authorships: [{ author: { display_name: "A. Author" } }],
    primary_location: {
      source: {
        display_name: "Journal of Anthropology",
        host_organization_name: "Anthro Press",
      },
    },
    biblio: { volume: "12", issue: "3", first_page: "101", last_page: "120" },
  };
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
type FetchLike = (url: string, init?: RequestInit) => Promise<FetchResponseLike>;

function mockOpenAlexOnce() {
  return vi.fn<FetchLike>(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      results: [
        work("Culture theory anthropology one"),
        work("Culture theory anthropology two", 2018, 30),
        work("Culture theory anthropology three", 2016, 10),
        work("Unrelated physics paper", 2001, 5),
      ],
    }),
  }));
}

/** The `search=` value of the last fetch call. */
function lastSearchParam(fetchMock: ReturnType<typeof mockOpenAlexOnce>): string {
  const calls = fetchMock.mock.calls;
  const url = String(calls[calls.length - 1][0]);
  return new URL(url).searchParams.get("search") ?? "";
}

beforeEach(() => {
  readFile.mockReset();
  writeFile.mockReset();
  mkdir.mockReset();
  // Default: nothing cached.
  readFile.mockRejectedValue(new Error("ENOENT"));
  writeFile.mockResolvedValue(undefined);
  mkdir.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openAlexProvider.search — jurusan (Course.major) as query context", () => {
  it("appends the major to the OpenAlex search term", async () => {
    const fetchMock = mockOpenAlexOnce();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);

    await openAlexProvider.search("Teori Antropologi Kontemporer", ["teori"], {
      major: "Antropologi",
      cache: false,
    });

    const search = lastSearchParam(fetchMock);
    expect(search).toContain("Teori Antropologi Kontemporer");
    expect(search).toContain("teori");
    expect(search).toContain("Antropologi");
  });

  it("sends a different query for the same topic under a different major", async () => {
    const fetchMock = mockOpenAlexOnce();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);

    await openAlexProvider.search("Teori Antropologi Kontemporer", [], {
      major: "Antropologi",
      cache: false,
    });
    const anthro = lastSearchParam(fetchMock);

    await openAlexProvider.search("Teori Antropologi Kontemporer", [], {
      major: "Sosiologi",
      cache: false,
    });
    const socio = lastSearchParam(fetchMock);

    expect(anthro).not.toBe(socio);
    expect(socio).toContain("Sosiologi");
  });

  it("omits the major cleanly when a course has none", async () => {
    const fetchMock = mockOpenAlexOnce();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);

    await openAlexProvider.search("Teori Antropologi Kontemporer", [], { cache: false });

    const search = lastSearchParam(fetchMock);
    expect(search).toBe("Teori Antropologi Kontemporer");
  });

  it("treats a blank/whitespace major as absent", async () => {
    const fetchMock = mockOpenAlexOnce();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);

    await openAlexProvider.search("Topik", [], { major: "   ", cache: false });

    expect(lastSearchParam(fetchMock)).toBe("Topik");
  });

  it("caches per major, so one discipline's results are never served to another", async () => {
    const fetchMock = mockOpenAlexOnce();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);

    await openAlexProvider.search("Topik Sama", [], { major: "Antropologi", cache: true });
    await openAlexProvider.search("Topik Sama", [], { major: "Sosiologi", cache: true });

    const writtenPaths = writeFile.mock.calls.map((c) => String(c[0]));
    expect(writtenPaths).toHaveLength(2);
    expect(writtenPaths[0]).not.toBe(writtenPaths[1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still reuses the cache for an identical topic+major", async () => {
    const fetchMock = mockOpenAlexOnce();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);

    await openAlexProvider.search("Topik Sama", [], { major: "Antropologi", cache: true });
    const cachedPayload = String(writeFile.mock.calls[0][1]);

    // Second call finds the entry the first one wrote.
    readFile.mockResolvedValue(cachedPayload);
    const second = await openAlexProvider.search("Topik Sama", [], {
      major: "Antropologi",
      cache: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.length).toBeGreaterThan(0);
  });

  it("returns [] on an empty OpenAlex response (never throws)", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);

    const result = await openAlexProvider.search("Nothing", [], { cache: false });
    expect(result).toEqual([]);
  });

  it("captures richer bibliographic fields and a doi.org sourceUrl", async () => {
    const fetchMock = mockOpenAlexOnce();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch);

    const result = await openAlexProvider.search("Culture theory", [], { cache: false });

    expect(result.length).toBeGreaterThan(0);
    const p = result[0];
    expect(p.doi).toBe("https://doi.org/10.1000/culture-theory-anthropology-one");
    expect(p.sourceUrl).toMatch(/^https:\/\/doi\.org\//);
    expect(p.venue).toBe("Journal of Anthropology");
    expect(p.volume).toBe("12");
    expect(p.issue).toBe("3");
    expect(p.pages).toBe("101-120");
    expect(p.publisher).toBe("Anthro Press");
    expect(p.type).toBe("article");
    expect(p.provider).toBe("openalex");
    expect(p.relevanceScore).toBe(0);
    expect(p.fullTextAvailable).toBe(true);
  });
});
