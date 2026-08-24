import { describe, it, expect } from "vitest";
import {
  APPROVAL_MIN_COUNT,
  defaultApprovedIndices,
  internationalQuotaForMajor,
  isInternationalJournal,
  relevanceScore,
  selectShortlist,
  titleHeuristicScore,
  tokenize,
} from "./scoring";

const base = {
  title: "Structuralism and Levi-Strauss",
  abstract: "A study of structural anthropology and binary oppositions.",
  year: 1990,
  citationCount: 100,
};

describe("tokenize", () => {
  it("lowercases and drops short tokens", () => {
    expect(tokenize("The Structuralism! Of Anthropology")).toEqual([
      "the",
      "structuralism",
      "anthropology",
    ]);
  });
});

describe("relevanceScore", () => {
  it("rewards keyword overlap", () => {
    const a = relevanceScore(base, ["structuralism", "anthropology"]);
    const b = relevanceScore(base, ["quantum", "physics"]);
    expect(a).toBeGreaterThan(b);
  });
  it("is bounded in [0,1]", () => {
    const s = relevanceScore(base, ["structuralism"]);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
  it("returns 0 with no query terms", () => {
    expect(relevanceScore(base, [])).toBe(0);
  });
  it("nudges Indonesian/English works above an otherwise-equal foreign-language work", () => {
    const terms = ["structuralism", "anthropology"];
    const id = relevanceScore({ ...base, language: "id" }, terms);
    const en = relevanceScore({ ...base, language: "en" }, terms);
    const fr = relevanceScore({ ...base, language: "fr" }, terms);
    const none = relevanceScore(base, terms);
    expect(id).toBeGreaterThan(fr);
    expect(en).toBeGreaterThan(fr);
    expect(id).toBeGreaterThan(none); // in-language tag earns a bonus; none has no tag
  });
});

describe("titleHeuristicScore (P2 — title as its own search query)", () => {
  it("rewards papers whose text contains the title's tokens and bigrams", () => {
    const s = titleHeuristicScore(
      { title: "Tingkatan aktor dalam hukum", abstract: "Membahas tingkatan aktor dan level hukum." },
      "Tingkatan aktor dan level hukum internasional"
    );
    expect(s).toBeGreaterThan(0);
  });
  it("returns 0 when the paper shares nothing with the title", () => {
    const s = titleHeuristicScore(
      { title: "Quantum computing", abstract: "qubits and gates" },
      "Tingkatan aktor dan hukum"
    );
    expect(s).toBe(0);
  });
  it("is bounded in [0,1]", () => {
    const s = titleHeuristicScore(
      { title: "hukum internasional aktor tingkatan", abstract: "hukum internasional aktor tingkatan" },
      "hukum internasional aktor tingkatan"
    );
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
  it("still scores 0 for an empty/short title", () => {
    expect(titleHeuristicScore({ title: "x", abstract: "y" }, "ai")).toBe(0);
  });
});

describe("selectShortlist", () => {
  const mk = (
    over: Partial<typeof base & { type?: string; venue?: string; language?: string }> = {}
  ) => ({ ...base, ...over });
  const papers = [
    mk({ title: "Structuralism A", citationCount: 200, year: 2018 }),
    mk({ title: "Structuralism B", citationCount: 50, year: 2005 }),
    mk({ title: "Unrelated C", citationCount: 1, year: 1990 }),
  ];

  it("keeps an absolute floor of 2 even on tiny sets", () => {
    const out = selectShortlist(papers, ["structuralism"], { minCount: 2 });
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it("takes roughly the top quartile for large sets", () => {
    const big = Array.from({ length: 12 }, (_, i) =>
      mk({ title: `Structuralism paper ${i}`, citationCount: i * 10, year: 2000 + i })
    );
    const out = selectShortlist(big, ["structuralism"], { minCount: 2 });
    expect(out.length).toBe(3); // ceil(12/4)
  });

  it("returns empty on empty input", () => {
    expect(selectShortlist([], ["x"])).toEqual([]);
  });

  it("guarantees at least minInternational international journals, backfilling from lower-relevance candidates", () => {
    // 10 domestic journal papers (Indonesian, no language tag but type journal
    // with venue) plus 3 untagged international journals — the top-k by relevance
    // is all domestic, so the quota must pull the international ones in.
    const domestic = Array.from({ length: 10 }, (_, i) =>
      mk({ title: `Domestic ${i}`, type: "journal", venue: "Jurnal Lokal", language: "id", citationCount: 200 - i, year: 2018 })
    );
    const intl = [
      mk({ title: "Intl A", type: "journal", venue: "Nature", language: "en", citationCount: 5, year: 2010 }),
      mk({ title: "Intl B", type: "journal", venue: "Cell", language: "en", citationCount: 4, year: 2010 }),
      mk({ title: "Intl C", type: "journal", venue: "PLOS", language: "fr", citationCount: 3, year: 2010 }),
    ];
    const out = selectShortlist([...domestic, ...intl], ["structuralism"], {
      minCount: 10,
      maxCount: 10,
      minInternational: 2,
    });
    expect(out.length).toBe(10);
    const intlCount = out.filter((p) => isInternationalJournal(p)).length;
    expect(intlCount).toBeGreaterThanOrEqual(2);
  });

  it("does not exceed the ceiling when backfilling international journals", () => {
    const papers = Array.from({ length: 20 }, (_, i) =>
      mk({ title: `P ${i}`, type: "journal", venue: "J", language: i < 12 ? "en" : "id", citationCount: i })
    );
    const out = selectShortlist(papers, ["structuralism"], { minCount: 10, maxCount: 10, minInternational: 2 });
    expect(out.length).toBe(10);
    expect(out.filter((p) => isInternationalJournal(p)).length).toBeGreaterThanOrEqual(2);
  });
});

describe("isInternationalJournal", () => {
  it("treats an untagged journal from an international index as international", () => {
    expect(isInternationalJournal({ type: "journal", venue: "American Journal" })).toBe(true);
    expect(isInternationalJournal({ type: "article", venue: "Cell" })).toBe(true);
  });
  it("excludes Indonesian-language journals (domestic leg)", () => {
    expect(isInternationalJournal({ type: "journal", venue: "Jurnal Nasional", language: "id" })).toBe(false);
  });
  it("excludes books and works without a venue", () => {
    expect(isInternationalJournal({ type: "book", venue: "Oxford" })).toBe(false);
    expect(isInternationalJournal({ type: "article" })).toBe(false);
    expect(isInternationalJournal({ type: undefined, venue: undefined, language: undefined })).toBe(false);
  });
  it("counts an English/other-language DOAJ journal as international", () => {
    expect(isInternationalJournal({ type: "journal", venue: "Springer", language: "en" })).toBe(true);
    expect(isInternationalJournal({ type: "journal", venue: "Revue", language: "fr" })).toBe(true);
  });
});

describe("internationalQuotaForMajor (Bug 2 — non-blocking gate)", () => {
  it("requires 2 international journals only for international/comparative majors", () => {
    expect(internationalQuotaForMajor("Hukum Internasional")).toBe(2);
    expect(internationalQuotaForMajor("Hubungan Internasional")).toBe(2);
    expect(internationalQuotaForMajor("Politik Komparatif")).toBe(2);
  });
  it("requires 0 for domestic majors so relevant domestic papers are kept", () => {
    expect(internationalQuotaForMajor("Hukum Tata Negara")).toBe(0);
    expect(internationalQuotaForMajor("Antropologi")).toBe(0);
    expect(internationalQuotaForMajor(undefined)).toBe(0);
    expect(internationalQuotaForMajor(null)).toBe(0);
  });
  it("selectShortlist with quota 0 never forces international papers and never throws", () => {
    const domestic = Array.from({ length: 10 }, (_, i) =>
      ({ ...base, title: `Domestic ${i}`, type: "journal", venue: "Jurnal Lokal", language: "id", citationCount: 200 - i, year: 2018 })
    );
    const out = selectShortlist(domestic, ["structuralism"], {
      minCount: 10,
      maxCount: 10,
      minInternational: 0,
    });
    expect(out.length).toBe(10);
    // No international journals forced in: the gate is informational, not blocking.
    expect(out.filter((p) => isInternationalJournal(p)).length).toBe(0);
  });
});

// The approval gate itself is NOT weakened by these defaults (R2/R3): they only
// decide what arrives pre-checked, and PaperReview still blocks an empty
// selection. See PaperReview.dom.test.tsx for that half of the contract.
describe("defaultApprovedIndices", () => {
  const mk = (relevanceScore: number, citationCount = 10) => ({ relevanceScore, citationCount });

  it("returns nothing for an empty shortlist", () => {
    expect(defaultApprovedIndices([])).toEqual([]);
  });

  it("pre-checks the strongest papers and excludes the weak tail", () => {
    // 8 papers -> quartile cut is 2, so only the two strongest pre-check.
    const papers = [mk(0.9), mk(0.2), mk(0.85), mk(0.1), mk(0.15), mk(0.12), mk(0.2), mk(0.05)];
    const idx = defaultApprovedIndices(papers);
    expect(idx).toEqual([0, 2]);
  });

  it("returns ascending indices so the caller can map back positionally", () => {
    const papers = [mk(0.1), mk(0.95), mk(0.2), mk(0.9), mk(0.15), mk(0.05), mk(0.3), mk(0.25)];
    const idx = defaultApprovedIndices(papers);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(idx).toEqual([1, 3]);
  });

  it("still proposes the floor when every score is weak, so the list is never all-unchecked", () => {
    // A uniformly weak batch must not force the student to build the source
    // list from zero — that is the friction this function exists to remove.
    const papers = [mk(0.01), mk(0.02), mk(0.0), mk(0.01)];
    const idx = defaultApprovedIndices(papers);
    expect(idx.length).toBeGreaterThanOrEqual(APPROVAL_MIN_COUNT);
  });

  it("handles a degenerate all-identical batch without checking nothing", () => {
    const papers = [mk(0), mk(0), mk(0), mk(0)];
    // Every score ties at the cut, so all pass — never an empty default.
    expect(defaultApprovedIndices(papers).length).toBeGreaterThanOrEqual(APPROVAL_MIN_COUNT);
  });

  it("keeps tied scores together rather than splitting them by array order", () => {
    const papers = [mk(0.5), mk(0.5), mk(0.5), mk(0.1), mk(0.1), mk(0.1), mk(0.1), mk(0.1)];
    // The three 0.5s tie at the cut; none may be arbitrarily dropped.
    expect(defaultApprovedIndices(papers)).toEqual([0, 1, 2]);
  });

  it("never pre-checks more papers than exist", () => {
    const one = defaultApprovedIndices([mk(0.9)]);
    expect(one).toEqual([0]);
  });

  it("breaks relevance ties by citation count", () => {
    const papers = [mk(0.5, 1), mk(0.5, 900), mk(0.1, 5), mk(0.1, 5)];
    // Both 0.5s tie at the cut and both pass; the citation signal only decides
    // ordering within the sort, so the low-relevance pair stays out.
    expect(defaultApprovedIndices(papers)).toEqual([0, 1]);
  });

  it("respects an explicit minCount", () => {
    const papers = [mk(0.9), mk(0.8), mk(0.1), mk(0.05)];
    expect(defaultApprovedIndices(papers, { minCount: 3 }).length).toBeGreaterThanOrEqual(3);
  });
});
