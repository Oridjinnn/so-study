import { describe, expect, it } from "vitest";
import { expandKeywords, scoringTerms, titleTokens } from "./keywords";

describe("titleTokens", () => {
  it("drops stopwords and short tokens", () => {
    expect(titleTokens("Teori Strukturalisme dan Budaya")).toEqual([
      "teori",
      "strukturalisme",
      "budaya",
    ]);
  });
});

describe("expandKeywords", () => {
  it("keeps user keywords first and dedupes against title tokens", () => {
    const out = expandKeywords("Teori Strukturalisme Budaya", ["strukturalisme"]);
    expect(out[0]).toBe("strukturalisme");
    // title token 'strukturalisme' should not be duplicated
    expect(out.filter((k) => k.toLowerCase() === "strukturalisme")).toHaveLength(1);
  });

  it("adds adjacent bigrams for phrase-level coverage", () => {
    const out = expandKeywords("Teori Strukturalisme Budaya");
    expect(out).toContain("teori strukturalisme");
    expect(out).toContain("strukturalisme budaya");
  });

  it("stays within the keyword count and character budgets", () => {
    const out = expandKeywords("Teori Strukturalisme Budaya dan Masyarakat serta Kekuasaan Negara", []);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.join(" ").length).toBeLessThanOrEqual(1000);
  });

  it("returns something usable even for an empty title", () => {
    expect(expandKeywords("", ["antropologi"])).toEqual(["antropologi"]);
  });
});

describe("scoringTerms", () => {
  it("stays concise (no bigrams) so overlap scoring is meaningful", () => {
    const out = scoringTerms("Teori Strukturalisme Budaya", ["foo"]);
    expect(out).toContain("foo");
    expect(out).not.toContain("teori strukturalisme"); // bigrams excluded
    expect(out).toContain("strukturalisme");
  });

  it("falls back to the title when nothing else is given", () => {
    expect(scoringTerms("")).toEqual([""]);
  });
});
