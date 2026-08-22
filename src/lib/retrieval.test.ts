import { describe, expect, it } from "vitest";
import { cosineSimilarity, rankChunks, rankChunksHybrid, type RankableChunk } from "./retrieval";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("is 0 for empty or mismatched vectors (no poison)", () => {
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe("rankChunksHybrid", () => {
  const chunks: RankableChunk[] = [
    { id: "a", text: "habitus adalah disposisi terinternalisasi bourdieu" },
    { id: "b", text: "modal budaya diturunkan dari keluarga ke sekolah" },
    { id: "c", text: "kapitol dan benua dalam novel fiksi" },
  ];

  it("collapses to lexical ranking when no query embedding is supplied", () => {
    const ranked = rankChunksHybrid(chunks, "habitus bourdieu", [], 3);
    expect(ranked[0].id).toBe("a");
  });

  it("ranks a lexically-absent but semantically-matching chunk via dense signal", () => {
    // Query shares NO tokens with chunk b, but we hand it b's exact vector so
    // dense cosine = 1. Hybrid must still surface b above the keyword match.
    const queryEmbedding = [0.9, 0.1, 0.2];
    const chunksWithVec: RankableChunk[] = [
      { id: "a", text: "habitus adalah disposisi terinternalisasi bourdieu", embedding: [0.1, 0.9, 0.2] },
      { id: "b", text: "modal budaya diturunkan dari keluarga ke sekolah", embedding: [0.9, 0.1, 0.2] },
      { id: "c", text: "kapitol dan benua dalam novel fiksi", embedding: [0.2, 0.2, 0.9] },
    ];
    const ranked = rankChunksHybrid(chunksWithVec, "whatever totally different words", queryEmbedding, 3);
    expect(ranked[0].id).toBe("b");
  });

  it("respects k and returns empty for no chunks", () => {
    expect(rankChunksHybrid([], "q", [1, 2, 3], 5)).toEqual([]);
    const ranked = rankChunksHybrid(chunks, "habitus", [], 1);
    expect(ranked).toHaveLength(1);
  });
});

describe("rankChunks (lexical baseline unchanged)", () => {
  it("returns top-k by BM25 and never throws on empty input", () => {
    expect(rankChunks([], "q", 3)).toEqual([]);
    const ranked = rankChunks(
      [
        { id: "x", text: "habitus bourdieu" },
        { id: "y", text: "ikan hiu laut dalam" },
      ],
      "habitus bourdieu",
      2,
    );
    expect(ranked[0].id).toBe("x");
  });
});
