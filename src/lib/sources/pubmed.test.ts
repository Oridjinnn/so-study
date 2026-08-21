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

import { pubMedProvider } from "./pubmed";

const ESEARCH_BODY = { esearchresult: { idlist: ["123", "456"] } };
const ESUMMARY_BODY = {
  result: {
    "123": {
      title: "PubMed Paper One",
      pubdate: "2020 Jan-Feb",
      authors: [{ name: "Doe FM" }, { name: "Smith AB" }],
      source: "J Tests",
      volume: "5",
      issue: "1",
      pages: "1-9",
      articleids: [
        { idtype: "pubmed", value: "123" },
        { idtype: "doi", value: "10.1000/pm" },
      ],
    },
  },
};

function mockEutils(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (url.includes("esearch.fcgi")) {
      return { ok: true, status: 200, json: async () => ESEARCH_BODY };
    }
    if (url.includes("esummary.fcgi")) {
      return { ok: true, status: 200, json: async () => ESUMMARY_BODY };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  });
}

beforeEach(() => {
  readFile.mockReset();
  writeFile.mockReset();
  mkdir.mockReset();
  readFile.mockRejectedValue(new Error("ENOENT"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pubMedProvider", () => {
  it("maps fields from esearch+esummary responses", async () => {
    const fetchMock = mockEutils();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const papers = await pubMedProvider.search("query", ["kw"], { perTopic: 10 });

    expect(papers).toHaveLength(1);
    const p = papers[0];
    expect(p.title).toBe("PubMed Paper One");
    expect(p.authors).toBe("Doe FM, Smith AB");
    expect(p.year).toBe(2020);
    expect(p.doi).toBe("10.1000/pm");
    expect(p.sourceUrl).toBe("https://doi.org/10.1000/pm");
    expect(p.citationCount).toBe(0);
    expect(p.venue).toBe("J Tests");
    expect(p.volume).toBe("5");
    expect(p.issue).toBe("1");
    expect(p.pages).toBe("1-9");
    expect(p.provider).toBe("pubmed");
    expect(p.type).toBe("article");
    expect(p.relevanceScore).toBe(0);
    expect(p.fullTextAvailable).toBe(false);
  });

  it("falls back to pubmed URL when no DOI", async () => {
    const fetchMock = mockEutils();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );
    const body = JSON.parse(JSON.stringify(ESUMMARY_BODY));
    delete body.result["123"].articleids;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("esearch.fcgi")) return { ok: true, status: 200, json: async () => ESEARCH_BODY };
      return { ok: true, status: 200, json: async () => body };
    });
    const papers = await pubMedProvider.search("q", [], { cache: false });
    expect(papers[0].doi).toBeUndefined();
    expect(papers[0].sourceUrl).toBe("https://pubmed.ncbi.nlm.nih.gov/123/");
  });

  it("returns [] when esearch fails", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );
    const papers = await pubMedProvider.search("q", [], { cache: false });
    expect(papers).toEqual([]);
  });

  it("returns [] (cached empty) when esearch returns no ids", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("esearch.fcgi")) {
        return { ok: true, status: 200, json: async () => ({ esearchresult: { idlist: [] } }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );
    const papers = await pubMedProvider.search("q", [], { cache: false });
    expect(papers).toEqual([]);
  });

  it("writes cache on miss and reads cache on hit", async () => {
    const fetchMock = mockEutils();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );
    const first = await pubMedProvider.search("cacheme", [], { cache: true });
    expect(first).toHaveLength(1);
    expect(writeFile).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    readFile.mockResolvedValue(JSON.stringify(first));
    const second = await pubMedProvider.search("cacheme", [], { cache: true });
    expect(second).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
