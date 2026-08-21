import { describe, expect, it } from "vitest";
import { formatAPA, toApaAuthors } from "./citation";

describe("toApaAuthors", () => {
  it("returns an empty string when no author is recorded", () => {
    expect(toApaAuthors(undefined)).toBe("");
    expect(toApaAuthors(null)).toBe("");
    expect(toApaAuthors("")).toBe("");
    expect(toApaAuthors("   ")).toBe("");
  });

  it("inverts a single 'Given Family' name to 'Family, I.'", () => {
    expect(toApaAuthors("Jane Doe")).toBe("Doe, J.");
  });

  it("keeps a name that is already inverted instead of re-parsing it", () => {
    // The comma here separates surname from initials, not two authors.
    expect(toApaAuthors("Bourdieu, P.")).toBe("Bourdieu, P.");
  });

  it("joins two authors with a serial comma before the ampersand", () => {
    expect(toApaAuthors("Jane Doe, John Smith")).toBe("Doe, J., & Smith, J.");
  });

  it("uses no ampersand for a lone author", () => {
    expect(toApaAuthors("Jane Doe")).not.toContain("&");
  });

  it("lists three or more authors with commas and a final ampersand", () => {
    expect(toApaAuthors("Jane Doe, John Smith, Ana Ruiz")).toBe(
      "Doe, J., Smith, J., & Ruiz, A.",
    );
  });

  it("accepts 'and' and '&' as author separators too", () => {
    expect(toApaAuthors("Jane Doe and John Smith")).toBe("Doe, J., & Smith, J.");
    expect(toApaAuthors("Jane Doe & John Smith")).toBe("Doe, J., & Smith, J.");
  });

  it("initialises every given name of a multi-part name", () => {
    expect(toApaAuthors("Jane Marie Doe")).toBe("Doe, J. M.");
  });

  it("converts a non-Western 'Given Family' name (Indonesian) correctly", () => {
    expect(toApaAuthors("Budi Santoso")).toBe("Santoso, B.");
    expect(toApaAuthors("Budi Santoso, Siti Aminah")).toBe(
      "Santoso, B., & Aminah, S.",
    );
  });

  it("keeps a mononym whole rather than emitting an empty surname", () => {
    expect(toApaAuthors("Plato")).toBe("Plato");
  });

  it("keeps several already-inverted names apart", () => {
    expect(toApaAuthors("Bourdieu, P., Passeron, J.-C.")).toBe(
      "Bourdieu, P., & Passeron, J.-C.",
    );
  });
});

describe("formatAPA — journal article", () => {
  const article = {
    authors: "Jane Doe, John Smith",
    year: 2020,
    title: "Habitus and practice",
    doi: "10.1234/abcd",
    venue: "Journal of Social Theory",
    volume: "12",
    issue: "3",
    pages: "45-67",
  };

  it("renders the full APA-7 journal form", () => {
    expect(formatAPA(article)).toBe(
      "Doe, J., & Smith, J. (2020). Habitus and practice. *Journal of Social Theory*, 12(3), 45–67. https://doi.org/10.1234/abcd",
    );
  });

  it("does not italicise the article title, only the journal", () => {
    const out = formatAPA(article);
    expect(out).toContain("*Journal of Social Theory*");
    expect(out).not.toContain("*Habitus and practice*");
  });

  it("renders the DOI as a canonical https://doi.org/ link", () => {
    expect(formatAPA(article)).toContain("https://doi.org/10.1234/abcd");
  });

  it("prefers the DOI over the provider URL", () => {
    const out = formatAPA({ ...article, sourceUrl: "https://openalex.org/W1" });
    expect(out).toContain("https://doi.org/10.1234/abcd");
    expect(out).not.toContain("openalex.org");
  });

  it("falls back to the provider URL when there is no DOI", () => {
    const out = formatAPA({ ...article, doi: undefined, sourceUrl: "https://openalex.org/W1" });
    expect(out).toBe(
      "Doe, J., & Smith, J. (2020). Habitus and practice. *Journal of Social Theory*, 12(3), 45–67. https://openalex.org/W1",
    );
  });

  it("omits the issue when only a volume is known", () => {
    expect(formatAPA({ ...article, issue: undefined })).toBe(
      "Doe, J., & Smith, J. (2020). Habitus and practice. *Journal of Social Theory*, 12, 45–67. https://doi.org/10.1234/abcd",
    );
  });

  it("omits volume/issue entirely when neither is known", () => {
    expect(formatAPA({ ...article, volume: undefined, issue: undefined })).toBe(
      "Doe, J., & Smith, J. (2020). Habitus and practice. *Journal of Social Theory*, 45–67. https://doi.org/10.1234/abcd",
    );
  });

  it("leaves no double space or stray separator when pages are missing", () => {
    const out = formatAPA({ ...article, pages: undefined });
    expect(out).toBe(
      "Doe, J., & Smith, J. (2020). Habitus and practice. *Journal of Social Theory*, 12(3). https://doi.org/10.1234/abcd",
    );
    expect(out).not.toContain("  ");
  });
});

describe("formatAPA — book", () => {
  it("italicises the book title and cites the publisher", () => {
    expect(
      formatAPA({
        authors: "Pierre Bourdieu",
        year: 1977,
        title: "Outline of a Theory of Practice",
        publisher: "Cambridge University Press",
        type: "book",
        sourceUrl: "https://openalex.org/W1",
      }),
    ).toBe(
      "Bourdieu, P. (1977). *Outline of a Theory of Practice*. Cambridge University Press. https://openalex.org/W1",
    );
  });

  it("drops the dangling period when the publisher is unknown", () => {
    expect(
      formatAPA({
        authors: "Pierre Bourdieu",
        year: 1977,
        title: "Outline of a Theory of Practice",
        type: "book",
        sourceUrl: "https://openalex.org/W1",
      }),
    ).toBe("Bourdieu, P. (1977). *Outline of a Theory of Practice*. https://openalex.org/W1");
  });

  it("ignores a venue on a book: the book form wins", () => {
    expect(
      formatAPA({
        authors: "Pierre Bourdieu",
        year: 1990,
        title: "The Logic of Practice",
        venue: "Polity Press",
        publisher: "Polity Press",
        type: "book",
      }),
    ).toBe("Bourdieu, P. (1990). *The Logic of Practice*. Polity Press.");
  });
});

describe("formatAPA — no venue", () => {
  it("renders a preprint (DOI but no journal) without a container", () => {
    expect(
      formatAPA({
        authors: "Budi Santoso",
        year: 2024,
        title: "Draft findings on study habits",
        doi: "10.5555/xyz123",
        type: "preprint",
      }),
    ).toBe("Santoso, B. (2024). Draft findings on study habits. https://doi.org/10.5555/xyz123");
  });

  it("renders an article whose venue was never recorded", () => {
    expect(
      formatAPA({
        authors: "Jane Doe",
        year: 2015,
        title: "An untraced article",
        type: "article",
        sourceUrl: "https://openalex.org/W9",
      }),
    ).toBe("Doe, J. (2015). An untraced article. https://openalex.org/W9");
  });

  it("drops volume/issue/pages that have no container to sit in", () => {
    const out = formatAPA({
      authors: "Jane Doe",
      year: 2015,
      title: "An untraced article",
      volume: "4",
      issue: "2",
      pages: "10-20",
      sourceUrl: "https://openalex.org/W9",
    });
    expect(out).toBe("Doe, J. (2015). An untraced article. https://openalex.org/W9");
  });

  it("emits just the reference when there is no link at all", () => {
    expect(formatAPA({ authors: "Jane Doe", year: 2015, title: "No link" })).toBe(
      "Doe, J. (2015). No link.",
    );
  });
});

describe("formatAPA — missing metadata", () => {
  it("uses (n.d.) instead of inventing a year", () => {
    expect(formatAPA({ authors: "Jane Doe", title: "Undated work" })).toBe(
      "Doe, J. (n.d.). Undated work.",
    );
    expect(formatAPA({ authors: "Jane Doe", year: null, title: "Undated work" })).toBe(
      "Doe, J. (n.d.). Undated work.",
    );
    expect(formatAPA({ authors: "Jane Doe", year: 0, title: "Undated work" })).toBe(
      "Doe, J. (n.d.). Undated work.",
    );
  });

  it("starts with the year when no author is known, without a leading space", () => {
    expect(formatAPA({ title: "Anonymous report", year: 2019 })).toBe(
      "(2019). Anonymous report.",
    );
  });

  it("trims a padded title instead of exporting the padding", () => {
    expect(formatAPA({ authors: "Jane Doe", year: 2019, title: "  Spaced  out  " })).toBe(
      "Doe, J. (2019). Spaced out.",
    );
  });

  it("never prints 'undefined' or 'null' for an absent field", () => {
    const out = formatAPA({ title: "Bare record" });
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("null");
    expect(out).toBe("(n.d.). Bare record.");
  });

  it("treats an unparseable DOI as no DOI and keeps the provider URL", () => {
    expect(
      formatAPA({
        authors: "Jane Doe",
        year: 2020,
        title: "Bad DOI",
        doi: "not-a-doi",
        sourceUrl: "https://openalex.org/W2",
      }),
    ).toBe("Doe, J. (2020). Bad DOI. https://openalex.org/W2");
  });
});
