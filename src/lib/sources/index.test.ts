import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the four providers + the citation enricher so the aggregator test never
// touches the network. Each mock is hoisted so vi.mock factories can reference it.
const mocks = vi.hoisted(() => ({
  oa: vi.fn(),
  cr: vi.fn(),
  s2: vi.fn(),
  pm: vi.fn(),
  doaj: vi.fn(),
  enrich: vi.fn(async (p: unknown) => p),
}));

vi.mock("./openalex", () => ({
  openAlexProvider: { name: "openalex", search: (...a: unknown[]) => mocks.oa(...a) },
}));
vi.mock("./crossref", () => ({
  crossrefProvider: { name: "crossref", search: (...a: unknown[]) => mocks.cr(...a) },
}));
vi.mock("./semanticscholar", () => ({
  semanticScholarProvider: { name: "semanticscholar", search: (...a: unknown[]) => mocks.s2(...a) },
}));
vi.mock("./pubmed", () => ({
  pubMedProvider: { name: "pubmed", search: (...a: unknown[]) => mocks.pm(...a) },
}));
vi.mock("./doaj", () => ({
  doajProvider: { name: "doaj", search: (...a: unknown[]) => mocks.doaj(...a) },
}));
vi.mock("./citations", () => ({ enrichCitations: (p: unknown) => mocks.enrich(p) }));

import { retrieveSources } from "./index";
import type { SourcePaper } from "./types";

function mk(partial: Partial<SourcePaper> & { title: string }): SourcePaper {
  return {
    title: partial.title,
    authors: partial.authors ?? "Doe, J.",
    year: partial.year ?? 2020,
    abstract: partial.abstract ?? "abstract text",
    sourceUrl: partial.sourceUrl ?? "https://doi.org/10.1/x",
    citationCount: partial.citationCount ?? 5,
    relevanceScore: 0,
    fullTextAvailable: false,
    provider: partial.provider ?? "openalex",
    doi: partial.doi,
    venue: partial.venue,
    volume: partial.volume,
    issue: partial.issue,
    pages: partial.pages,
    publisher: partial.publisher,
    type: partial.type,
  };
}

beforeEach(() => {
  for (const fn of [mocks.oa, mocks.cr, mocks.s2, mocks.pm, mocks.doaj, mocks.enrich]) {
    fn.mockReset();
  }
  mocks.doaj.mockResolvedValue([]);
  mocks.enrich.mockImplementation(async (p: unknown) => p);
});

describe("retrieveSources", () => {
  it("dedupes by DOI across providers and merges bibliographic metadata", async () => {
    mocks.oa.mockResolvedValue([mk({ title: "Alpha", doi: "10.1/alpha", provider: "openalex" })]);
    mocks.cr.mockResolvedValue([
      mk({ title: "Alpha", doi: "10.1/alpha", provider: "crossref", venue: "J X", volume: "1", issue: "2", pages: "3-4" }),
    ]);
    mocks.s2.mockResolvedValue([]);
    mocks.pm.mockResolvedValue([]);

    const res = await retrieveSources("Alpha", ["x"], { perTopic: 10 });

    expect(res).toHaveLength(1);
    expect(res[0].venue).toBe("J X");
    expect(res[0].provider).toBe("crossref+openalex");
    expect(res[0].relevanceScore).toBeGreaterThanOrEqual(0);
  });

  it("throws only when all providers return nothing", async () => {
    for (const fn of [mocks.oa, mocks.cr, mocks.s2, mocks.pm, mocks.doaj]) fn.mockResolvedValue([]);
    await expect(retrieveSources("q")).rejects.toThrow(/All source providers failed/);
  });

  it("drops a rejecting provider but keeps the rest", async () => {
    mocks.oa.mockRejectedValue(new Error("boom"));
    mocks.cr.mockResolvedValue([mk({ title: "Beta", doi: "10.1/beta", provider: "crossref", venue: "J Y" })]);
    mocks.s2.mockResolvedValue([]);
    mocks.pm.mockResolvedValue([]);
    mocks.doaj.mockResolvedValue([]);

    const res = await retrieveSources("Beta", [], { perTopic: 10 });
    expect(res).toHaveLength(1);
    expect(res[0].title).toBe("Beta");
  });

  it("returns a bounded shortlist", async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      mk({ title: `T${i}`, doi: `10.1/t${i}`, provider: "openalex" })
    );
    mocks.oa.mockResolvedValue(many);
    mocks.cr.mockResolvedValue([]);
    mocks.s2.mockResolvedValue([]);
    mocks.pm.mockResolvedValue([]);

    const res = await retrieveSources("Many", [], { perTopic: 10 });
    expect(res.length).toBeGreaterThan(0);
    expect(res.length).toBeLessThanOrEqual(40);
  });
});
