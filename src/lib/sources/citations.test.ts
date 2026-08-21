import { afterEach, describe, expect, it, vi } from "vitest";

import { enrichCitations } from "./citations";
import { SourcePaper } from "./types";

function paper(over: Partial<SourcePaper>): SourcePaper {
  return {
    title: "T",
    authors: "A",
    year: 2020,
    abstract: "",
    sourceUrl: "",
    citationCount: 0,
    relevanceScore: 0,
    fullTextAvailable: false,
    provider: "crossref",
    type: "article",
    ...over,
  };
}

describe("enrichCitations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SCITE_API_KEY;
  });

  it("fills a zero citationCount from COCI citing count", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [
        { citing: "10.1/a" },
        { citing: "10.1/b" },
        { citing: "10.1/c" },
      ],
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const papers = [paper({ doi: "10.1000/x", citationCount: 0 })];
    const out = await enrichCitations(papers);

    expect(out[0].citationCount).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://opencitations.net/api/v1/citations/10.1000%2Fx"
    );
  });

  it("does not overwrite an existing positive citationCount", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ citing: "10.1/a" }],
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const papers = [paper({ doi: "10.1000/x", citationCount: 9 })];
    const out = await enrichCitations(papers);
    expect(out[0].citationCount).toBe(9);
  });

  it("returns a paper without doi unchanged", async () => {
    const fetchMock = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const papers = [paper({ doi: undefined, citationCount: 0 })];
    const out = await enrichCitations(papers);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out[0].citationCount).toBe(0);
  });

  it("leaves papers unchanged when the fetch throws", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const papers = [paper({ doi: "10.1000/x", citationCount: 0 })];
    const out = await enrichCitations(papers);

    expect(out).toHaveLength(1);
    expect(out[0].citationCount).toBe(0);
  });

  it("uses Scite when SCITE_API_KEY is set and raises the count", async () => {
    process.env.SCITE_API_KEY = "secret";
    let callCount = 0;
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("opencitations.net")) {
        callCount++;
        return { ok: true, status: 200, json: async () => [] };
      }
      // Scite call
      return {
        ok: true,
        status: 200,
        json: async () => ({ citations: { supporting: 4, contrasting: 1 } }),
      };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchMock as unknown as typeof globalThis.fetch
    );

    const papers = [paper({ doi: "10.1000/x", citationCount: 0 })];
    const out = await enrichCitations(papers);

    expect(out[0].citationCount).toBe(5);
    expect(callCount).toBe(1);
    const sciteCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("api.scite.ai"));
    expect(sciteCall).toBeDefined();
    expect(sciteCall![1]?.headers).toEqual({ Authorization: "Bearer secret" });
  });
});
