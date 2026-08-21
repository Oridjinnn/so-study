import { afterEach, describe, expect, it, vi } from "vitest";
import { doajProvider } from "./doaj";
import type { SourcePaper } from "./types";

// DOAJ responds with `bibjson`-wrapped articles; we exercise the mapping + the
// graceful-degrade contract (network down -> []). fetch is stubbed so the test
// touches no network (rule E3/G10).
const DOAJ_JSON = {
  results: [
    {
      bibjson: {
        title: "Strukturalisme dalam Antropologi Indonesia",
        author: [{ name: "Budi Santoso" }, { name: "Ani Wijaya" }],
        year: "2021",
        abstract: ["Artikel ini membahas strukturalisme dan opposasi biner."],
        language: ["ID"],
        identifier: [{ type: "doi", id: "10.1234/idn.2021.0001" }],
        link: [{ type: "fulltext", url: "https://journal.id/article/1" }],
        journal: { title: "Jurnal Antropologi Indonesia", publisher: "UI Press", volume: "12", number: "3" },
        start_page: "1",
        end_page: "15",
      },
    },
    {
      bibjson: {
        title: "Open access without a DOI",
        author: [{ name: "Jane Roe" }],
        year: 2019,
        abstract: ["No identifier here."],
        language: ["EN"],
        link: [{ type: "fulltext", url: "https://oa.example.org/x" }],
        journal: { title: "Global OA" },
      },
    },
    {
      bibjson: { title: "" }, // dropped: empty title
    },
  ],
};

function mockFetch(json: unknown, ok = true) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => json } as Response);
}

describe("doajProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps DOAJ articles to SourcePaper with language + DOI", async () => {
    mockFetch(DOAJ_JSON);
    const out = await doajProvider.search("strukturalisme", [], { perTopic: 10, cache: false });
    expect(out).toHaveLength(2);
    const id = out.find((p) => p.language === "id") as SourcePaper;
    expect(id.title).toContain("Strukturalisme");
    expect(id.doi).toBe("10.1234/idn.2021.0001");
    expect(id.sourceUrl).toBe("https://doi.org/10.1234/idn.2021.0001");
    expect(id.authors).toBe("Budi Santoso, Ani Wijaya");
    expect(id.year).toBe(2021);
    expect(id.provider).toBe("doaj");
    expect(id.fullTextAvailable).toBe(true);
    const en = out.find((p) => p.language === "en") as SourcePaper;
    expect(en.sourceUrl).toBe("https://oa.example.org/x");
  });

  it("returns [] on HTTP failure (never throws)", async () => {
    mockFetch({}, false);
    const out = await doajProvider.search("x", [], { perTopic: 10, cache: false });
    expect(out).toEqual([]);
  });

  it("returns [] on network error (degrade, never throw)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const out = await doajProvider.search("x", [], { perTopic: 10, cache: false });
    expect(out).toEqual([]);
  });
});
