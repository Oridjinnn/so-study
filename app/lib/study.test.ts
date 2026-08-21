import { describe, expect, it } from "vitest";
import { slugifyHeading, visibleTabIds } from "./study";

describe("visibleTabIds", () => {
  it("returns only the test tab in closed-book mode", () => {
    expect(visibleTabIds(true)).toEqual(["test"]);
  });

  it("returns all four tabs when open-book", () => {
    expect(visibleTabIds(false)).toEqual(["read", "ask", "test", "sources"]);
  });
});

describe("slugifyHeading", () => {
  it("lowercases text", () => {
    expect(slugifyHeading("Mayer's Multimedia")).toBe("mayers-multimedia");
  });

  it("strips punctuation", () => {
    expect(slugifyHeading("Hello, World! (Test)")).toBe("hello-world-test");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugifyHeading("Learning by Doing")).toBe("learning-by-doing");
  });

  it("collapses multiple spaces into a single hyphen", () => {
    expect(slugifyHeading("Too    Many   Spaces")).toBe("too-many-spaces");
  });

  it("trims surrounding whitespace", () => {
    expect(slugifyHeading("   spaced out   ")).toBe("spaced-out");
  });
});
