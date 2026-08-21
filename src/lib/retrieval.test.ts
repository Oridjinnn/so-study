import { describe, expect, it } from "vitest";
import { rankChunks } from "./retrieval";

const CHUNKS = [
  { id: "c1", text: "Fotosintesis mengubah cahaya matahari menjadi energi kimia pada tumbuhan." },
  { id: "c2", text: "Respirasi seluler melepas energi dari glukosa di dalam mitokondria." },
  { id: "c3", text: "Kromosom membawa materi genetik yang diwariskan dari induk ke keturunan." },
];

describe("rankChunks", () => {
  it("ranks the most-overlapping chunk first", () => {
    const ranked = rankChunks(CHUNKS, "fotosintesis cahaya matahari tumbuhan", 3);
    expect(ranked[0].id).toBe("c1");
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it("returns empty array when there are no chunks", () => {
    expect(rankChunks([], "apapun", 5)).toEqual([]);
  });

  it("respects the requested k", () => {
    const ranked = rankChunks(CHUNKS, "energi sel", 2);
    expect(ranked.length).toBe(2);
  });

  it("falls back to the first k chunks when the query has no lexical overlap", () => {
    const ranked = rankChunks(CHUNKS, "zxqwv yyy kjhgf", 2);
    expect(ranked.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(ranked.every((c) => c.score === 0)).toBe(true);
  });

  it("ignores stopwords so they do not dominate the ranking", () => {
    // "dan" / "yang" are stopwords; the real signal term is "mitokondria".
    const ranked = rankChunks(CHUNKS, "dan yang mitokondria", 3);
    expect(ranked[0].id).toBe("c2");
  });


  it("never produces NaN when every chunk is stopwords (avgdl === 0)", () => {
    const stopwordChunks = [
      { id: "s1", text: "dan yang pada untuk dengan" },
      { id: "s2", text: "the a an and or of to in on" },
    ];
    const ranked = rankChunks(stopwordChunks, "mitokondria fotosintesis", 2);
    // No lexical overlap -> fallback returns the first k chunks, all finite.
    expect(ranked.every((c) => Number.isFinite(c.score))).toBe(true);
    expect(ranked.every((c) => c.score === 0)).toBe(true);
    expect(ranked.length).toBe(2);
  });

  it("uses IDF-only scoring (no NaN) when avgdl is zero but a term matches", () => {
    // avgdl === 0 because every chunk tokenizes to nothing, so the guard path
    // must keep scores finite rather than NaN.
    const stopwordChunks = [
      { id: "s1", text: "dan yang anak" },
      { id: "s2", text: "the a or book" },
    ];
    const ranked = rankChunks(stopwordChunks, "book", 2);
    expect(ranked.every((c) => Number.isFinite(c.score))).toBe(true);
  });

  it("is deterministic across calls", () => {
    const a = rankChunks(CHUNKS, "energi tumbuhan", 3);
    const b = rankChunks(CHUNKS, "energi tumbuhan", 3);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });
});
