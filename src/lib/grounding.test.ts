import { describe, expect, it } from "vitest";
import {
  GROUNDING_MIN_OVERLAP,
  verifyGrounding,
  type GroundingSource,
} from "./grounding";

// The harness is the only thing standing between "cited" and "grounded": if it
// silently passes an impossible citation the whole approval gate is theatre, and
// if it flags legitimate prose the student learns to ignore the report. Both
// failure directions are asserted here, on fixed inputs (no LLM, no randomness).

const SOURCES: GroundingSource[] = [
  {
    id: "p1",
    title: "Pertukaran simbolik dan solidaritas sosial",
    text:
      "Artikel ini menganalisis ritual pertukaran hadiah pada masyarakat kepulauan " +
      "dan menunjukkan bahwa pertukaran simbolik memperkuat solidaritas sosial " +
      "antar klan melalui kewajiban timbal balik.",
  },
  {
    id: "p2",
    title: "Globalisasi dan identitas budaya lokal",
    text:
      "Studi etnografis mengenai bagaimana arus globalisasi mengubah identitas " +
      "budaya lokal, dengan fokus pada praktik konsumsi dan media di kota kecil.",
  },
];

const grounded = (markdown: string) =>
  verifyGrounding({ contentMarkdown: markdown, sourcePaperIds: ["p1", "p2"] }, SOURCES);

describe("verifyGrounding — in-range, well-anchored citations", () => {
  it("passes a module whose cited sentences share vocabulary with their source", () => {
    const report = grounded(
      "Ritual pertukaran hadiah memperkuat solidaritas sosial antar klan [1].\n" +
        "Arus globalisasi mengubah identitas budaya lokal melalui praktik konsumsi media [2].",
    );
    expect(report.checked).toBe(2);
    expect(report.flagged).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.score).toBe(1);
  });

  it("treats a module without inline citations as trivially ok (nothing to check)", () => {
    const report = grounded("# Konsep kunci\n\nModul ini belum menyitir apa pun.");
    expect(report).toEqual({ ok: true, checked: 0, flagged: [], score: 1 });
  });

  it("does not over-flag legitimate short citations", () => {
    // "Lihat [2]." carries too few content words to judge: counted, not flagged.
    const report = grounded("Lihat [2].");
    expect(report.checked).toBe(1);
    expect(report.flagged).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("checks every citation in a sentence that cites two papers", () => {
    const report = grounded(
      "Pertukaran simbolik dan identitas budaya lokal sama-sama dibentuk oleh " +
        "kewajiban timbal balik serta arus globalisasi [1][2].",
    );
    expect(report.checked).toBe(2);
    expect(report.ok).toBe(true);
  });
});

describe("verifyGrounding — impossible citations", () => {
  it("flags an out-of-range [n] that no approved paper can back", () => {
    const report = grounded(
      "Pertukaran simbolik memperkuat solidaritas sosial antar klan [3].",
    );
    expect(report.checked).toBe(1);
    expect(report.flagged).toHaveLength(1);
    expect(report.flagged[0]).toMatchObject({ index: 0, n: 3 });
    expect(report.flagged[0].reason).toContain("out of range");
    expect(report.ok).toBe(false);
    expect(report.score).toBe(0);
  });

  it("flags [0] as well (citations are 1-based)", () => {
    const report = grounded(
      "Klaim ini mengaku bersumber dari paper nol tentang solidaritas sosial [0].",
    );
    expect(report.flagged.map((f) => f.n)).toEqual([0]);
  });

  it("flags a citation whose paper id was never supplied as a source", () => {
    const report = verifyGrounding(
      {
        contentMarkdown: "Pertukaran simbolik memperkuat solidaritas sosial antar klan [1].",
        sourcePaperIds: ["p-missing"],
      },
      SOURCES,
    );
    expect(report.flagged).toHaveLength(1);
    expect(report.flagged[0].reason).toContain("unverifiable");
    expect(report.ok).toBe(false);
  });
});

describe("verifyGrounding — post-rationalization", () => {
  it("flags a cited sentence with near-zero overlap against its source", () => {
    const report = grounded(
      "Algoritma kompresi berkas biner mempercepat unggahan jaringan pita sempit [1].",
    );
    expect(report.checked).toBe(1);
    expect(report.flagged).toHaveLength(1);
    expect(report.flagged[0]).toMatchObject({ index: 0, n: 1 });
    expect(report.flagged[0].reason).toContain("post-rationalization");
    expect(report.ok).toBe(false);
  });

  it("flags a swapped citation: right prose, wrong paper", () => {
    // Sentence 1 belongs to p1 and sentence 2 to p2; both cite the other.
    const report = grounded(
      "Kompresi berkas biner mempercepat unggahan jaringan pita sempit [2].\n" +
        "Protokol perutean paket menurunkan latensi pusat data secara terukur [1].",
    );
    expect(report.checked).toBe(2);
    expect(report.flagged.map((f) => f.n)).toEqual([2, 1]);
    expect(report.score).toBe(0);
  });

  it("keeps the flag threshold at the documented, lenient value", () => {
    // Guards against a silent tightening that would start flagging real modules.
    expect(GROUNDING_MIN_OVERLAP).toBeLessThanOrEqual(0.05);
    expect(GROUNDING_MIN_OVERLAP).toBeGreaterThan(0);
  });

  it("does not flag an Indonesian module citing an English abstract", () => {
    // The real corpus: OpenAlex abstracts are English, the module is Indonesian.
    // A faithful translation shares no tokens, so the lexical floor is mute —
    // it must stay silent instead of flagging every citation in the module.
    const english: GroundingSource[] = [
      {
        id: "p1",
        title: "Symbolic exchange and social solidarity in island societies",
        text:
          "This article analyses gift exchange rituals and shows that symbolic " +
          "exchange reinforces the solidarity between clans through reciprocal obligation.",
      },
    ];
    const report = verifyGrounding(
      {
        contentMarkdown:
          "Konsep kunci pertama adalah kewajiban timbal balik yang mengikat pemberi " +
          "dan penerima dalam jaringan kekerabatan [1].\n" +
          "Menurut sumber tersebut, praktik ini menciptakan kewajiban jangka panjang " +
          "di antara kelompok yang saling berhubungan [1].",
        sourcePaperIds: ["p1"],
      },
      english,
    );
    expect(report.checked).toBe(2);
    expect(report.flagged).toEqual([]);
    expect(report.ok).toBe(true);

    // The structural check is NOT waived by the language guard.
    const impossible = verifyGrounding(
      { contentMarkdown: "Klaim tanpa sumber yang sah dalam modul ini [4].", sourcePaperIds: ["p1"] },
      english,
    );
    expect(impossible.flagged.map((f) => f.n)).toEqual([4]);
  });
});

describe("verifyGrounding — score", () => {
  const good = "Ritual pertukaran hadiah memperkuat solidaritas sosial antar klan [1].";
  const good2 =
    "Arus globalisasi mengubah identitas budaya lokal melalui praktik konsumsi media [2].";
  const bad = "Algoritma kompresi berkas biner mempercepat unggahan pita sempit [1].";
  const bad2 = "Protokol perutean paket menurunkan latensi pusat data terukur [2].";

  it("decreases monotonically as flags accumulate over the same citation count", () => {
    const scores = [
      grounded([good, good2, good, good2].join("\n")).score,
      grounded([bad, good2, good, good2].join("\n")).score,
      grounded([bad, bad2, good, good2].join("\n")).score,
      grounded([bad, bad2, bad, good2].join("\n")).score,
      grounded([bad, bad2, bad, bad2].join("\n")).score,
    ];
    expect(scores).toEqual([1, 0.75, 0.5, 0.25, 0]);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it("reports score = 1 - flagged/checked", () => {
    const report = grounded([good, good2, bad].join("\n"));
    expect(report.checked).toBe(3);
    expect(report.flagged).toHaveLength(1);
    expect(report.score).toBe(0.6667);
  });

  it("is deterministic: the same input yields an identical report", () => {
    const markdown = [good, bad, good2, bad2, "Lihat [9]."].join("\n");
    expect(grounded(markdown)).toEqual(grounded(markdown));
  });
});
