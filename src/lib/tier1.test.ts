import { describe, expect, it } from "vitest";
import { UNCITED_RATIO_THRESHOLD, citedSentences, verifyTier1 } from "./tier1";

// Tier 1 is the deterministic gate, so every test here uses SYNTHETIC module text
// with deliberately planted defects: a phantom citation, a run of uncited claims,
// a name and a number that are not in the cited source. The point is that the
// verdicts are decidable by string matching alone — no model, no judgement, and
// identical on every run.

const SOURCES = [
  {
    id: "p1",
    title: "The Social Construction of Reality",
    text:
      "Berger and Luckmann describe externalization, objectivation and internalization " +
      "as the dialectic of social reality. The 1966 study reports 1500 interviews.",
  },
  {
    id: "p2",
    title: "Outline of a Theory of Practice",
    text: "Bourdieu develops habitus as embodied disposition, observed in Kabylia.",
  },
];
const PAPER_IDS = ["p1", "p2"];

function mod(contentMarkdown: string, sourcePaperIds = PAPER_IDS) {
  return { contentMarkdown, sourcePaperIds };
}

describe("citedSentences", () => {
  it("returns one entry per sentence with its distinct citation numbers", () => {
    const out = citedSentences("Klaim satu [1]. Klaim dua [2][2] dan [3].\nTanpa sitasi.");
    expect(out).toHaveLength(2);
    expect(out[0].citations).toEqual([1]);
    expect(out[1].citations).toEqual([2, 3]);
  });
});

describe("Tier 1 — citation existence (hard FAIL)", () => {
  it("detects a phantom citation and BLOCKS the module", () => {
    const report = verifyTier1(
      mod("Habitus adalah disposisi yang mewujud dalam tubuh [7]."),
      SOURCES,
    );
    expect(report.citations.total).toBe(1);
    expect(report.citations.valid).toBe(0);
    expect(report.citations.phantom).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.blocked).toBe(true);
    const fail = report.findings.find((f) => f.check === "citation_exists");
    expect(fail?.severity).toBe("fail");
    expect(fail?.n).toBe(7);
    // The offending sentence travels with the finding: the targeted repair pass
    // quotes it back instead of asking for a blind rewrite.
    expect(fail?.claimText).toContain("Habitus adalah disposisi");
    expect(fail?.reason).toContain("[7]");
  });

  it("passes a module whose every [n] resolves to an approved paper", () => {
    const report = verifyTier1(
      mod(
        "Realitas sosial dibentuk lewat eksternalisasi dan internalisasi [1].\n" +
          "Habitus adalah disposisi yang mewujud [2].",
      ),
      SOURCES,
    );
    expect(report.citations.phantom).toBe(0);
    expect(report.passed).toBe(true);
    expect(report.blocked).toBe(false);
    expect(report.findings.filter((f) => f.severity === "fail")).toHaveLength(0);
  });

  it("treats a citation index whose paper is NOT approved as a phantom", () => {
    // sourcePaperIds names p3, but only p1/p2 were approved and supplied.
    const report = verifyTier1(mod("Klaim yang mengutip paper tak disetujui [2].", ["p1", "p3"]), SOURCES);
    expect(report.citations.phantom).toBe(1);
    expect(report.blocked).toBe(true);
    expect(report.findings[0].reason).toContain("p3");
  });

  it("counts one grounding relation per (sentence, n) pair, not per marker", () => {
    // The same sentence citing the same paper twice is ONE claim→source relation:
    // counting the marker twice would inflate both the total and the phantom count
    // and make the gauge's "valid/total" read like there is more evidence than
    // there is.
    const report = verifyTier1(mod("Klaim ganda [9] dan lagi [9]."), SOURCES);
    expect(report.citations.total).toBe(1);
    expect(report.citations.phantom).toBe(1);
    expect(report.findings.filter((f) => f.check === "citation_exists")).toHaveLength(1);
  });

  it("is deterministic: identical inputs give an identical report", () => {
    const text = "Klaim [1] lalu klaim palsu [8]. Menurut Giddens hal ini terjadi [2].";
    expect(verifyTier1(mod(text), SOURCES)).toEqual(verifyTier1(mod(text), SOURCES));
  });
});

describe("Tier 1 — uncited-claim ratio (WARN, never blocks)", () => {
  // Every line below matches the shared claim-cue definition (adalah / konsep /
  // teori / ":"), so the ratio is exactly countable by hand.
  const twoOfFive =
    "Habitus adalah disposisi yang mewujud dalam tubuh manusia [1].\n" +
    "Konsep field adalah ruang posisi sosial yang diperjuangkan [2].\n" +
    "Teori praktik adalah jembatan struktur dan agensi [1].\n" +
    "Modernitas adalah kondisi yang cair dan tidak stabil.\n" +
    "Globalisasi adalah proses yang mempercepat pertukaran budaya.";

  it("computes the ratio over ALL claims, not a truncated sample", () => {
    // 20 uncited claim lines: the MCQ helper caps at 16, so a capped count would
    // silently under-report here.
    const many = Array.from(
      { length: 20 },
      (_, i) => `Konsep nomor ${i} adalah gagasan yang dijelaskan panjang lebar dalam modul.`,
    ).join("\n");
    const report = verifyTier1(mod(many), SOURCES);
    expect(report.claims.total).toBe(20);
    expect(report.claims.uncited).toBe(20);
    expect(report.claims.ratio).toBe(1);
  });

  it("flags WARN above the threshold without blocking", () => {
    const report = verifyTier1(mod(twoOfFive), SOURCES);
    expect(report.claims.total).toBe(5);
    expect(report.claims.uncited).toBe(2);
    expect(report.claims.ratio).toBeCloseTo(0.4, 5);
    expect(report.claims.threshold).toBe(UNCITED_RATIO_THRESHOLD);
    expect(report.claims.overThreshold).toBe(true);
    const warns = report.findings.filter((f) => f.check === "uncited_claim_ratio");
    expect(warns.length).toBe(2);
    expect(warns.every((f) => f.severity === "warn")).toBe(true);
    // WARN is advisory: the module still ships.
    expect(report.blocked).toBe(false);
    expect(report.passed).toBe(true);
  });

  it("emits no per-claim findings at or below the threshold", () => {
    const oneOfFive =
      "Habitus adalah disposisi yang mewujud dalam tubuh manusia [1].\n" +
      "Konsep field adalah ruang posisi sosial yang diperjuangkan [2].\n" +
      "Teori praktik adalah jembatan struktur dan agensi [1].\n" +
      "Eksternalisasi adalah tahap pertama dialektika sosial [1].\n" +
      "Modernitas adalah kondisi yang cair dan tidak stabil.";
    const report = verifyTier1(mod(oneOfFive), SOURCES);
    expect(report.claims.ratio).toBeCloseTo(0.2, 5);
    expect(report.claims.overThreshold).toBe(false);
    expect(report.findings.filter((f) => f.check === "uncited_claim_ratio")).toHaveLength(0);
  });

  it("reports ratio 0 for a module with no claim-like lines", () => {
    const report = verifyTier1(mod("Ya.\nTidak.\nMungkin."), SOURCES);
    expect(report.claims.total).toBe(0);
    expect(report.claims.ratio).toBe(0);
    expect(report.claims.overThreshold).toBe(false);
  });
});

describe("Tier 1 — named-entity / number grounding (WARN)", () => {
  it("flags a name near a citation that is absent from the cited source", () => {
    const report = verifyTier1(
      mod("Interaksi ini dijelaskan menurut Giddens dalam kerangka strukturasi [2]."),
      SOURCES,
    );
    const warn = report.findings.find((f) => f.check === "entity_grounding");
    expect(warn?.severity).toBe("warn");
    expect(warn?.reason).toContain("Giddens");
    expect(warn?.n).toBe(2);
    expect(warn?.citedPaperId).toBe("p2");
    expect(report.entities.mismatched).toBeGreaterThan(0);
    expect(report.blocked).toBe(false); // regex NER has false positives → never a gate
  });

  it("does not flag a name that IS in the cited source", () => {
    const report = verifyTier1(
      mod("Analisis habitus menurut Bourdieu berakar pada praktik [2]."),
      SOURCES,
    );
    expect(report.findings.filter((f) => f.check === "entity_grounding")).toHaveLength(0);
    expect(report.entities.mismatched).toBe(0);
  });

  it("accepts a name present in ANY of the sentence's cited sources", () => {
    const report = verifyTier1(
      mod("Perbandingan antara pandangan Bourdieu dan Luckmann dibahas [1][2]."),
      SOURCES,
    );
    expect(report.entities.mismatched).toBe(0);
  });

  it("flags a fabricated specific number and ignores generic small ones", () => {
    const fabricated = verifyTier1(mod("Kajian ini mewawancarai 2500 informan [1]."), SOURCES);
    expect(fabricated.findings.some((f) => f.reason.includes("2500"))).toBe(true);

    const real = verifyTier1(mod("Kajian tahun 1966 mewawancarai 1500 informan [1]."), SOURCES);
    expect(real.findings.filter((f) => f.check === "entity_grounding")).toHaveLength(0);

    // "3" is not a checkable factual detail; flagging it would be pure noise.
    const small = verifyTier1(mod("Ada 3 tahap dalam dialektika ini [1]."), SOURCES);
    expect(small.entities.checked).toBe(0);
    expect(small.findings.filter((f) => f.check === "entity_grounding")).toHaveLength(0);
  });

  it("tolerates thousands/decimal formatting differences", () => {
    const report = verifyTier1(mod("Sekitar 1.500 wawancara dilakukan [1]."), SOURCES);
    expect(report.findings.filter((f) => f.check === "entity_grounding")).toHaveLength(0);
  });

  it("does not flag title-cased Indonesian concept labels the module also writes lowercase", () => {
    // "Moderasi Beragama" is a concept label, not a proper name: the module uses
    // "moderasi beragama" in running prose, which is how the check knows.
    const text =
      "Praktik moderasi beragama menjadi strategi utama di ruang publik.\n" +
      "Konsep Moderasi Beragama adalah jalan tengah yang meredam ekstremisme [1].";
    const report = verifyTier1(mod(text), SOURCES);
    expect(report.findings.filter((f) => f.check === "entity_grounding")).toHaveLength(0);
  });

  it("skips entity checking for a phantom citation (no source to compare)", () => {
    const report = verifyTier1(mod("Menurut Giddens hal ini terjadi [9]."), SOURCES);
    expect(report.findings.filter((f) => f.check === "entity_grounding")).toHaveLength(0);
    expect(report.findings.filter((f) => f.check === "citation_exists")).toHaveLength(1);
  });
});

describe("Tier 1 — combined report", () => {
  it("keeps FAIL and WARN separable: only FAIL blocks", () => {
    const text =
      "Habitus adalah disposisi yang mewujud dalam tubuh [2].\n" +
      "Menurut Giddens strukturasi menjelaskan hal ini [2].\n" +
      "Modernitas adalah kondisi yang cair dan tidak stabil.\n" +
      "Globalisasi adalah proses pertukaran yang dipercepat.\n" +
      "Klaim dengan sitasi palsu adalah masalah serius [8].";
    const report = verifyTier1(mod(text), SOURCES);
    const fails = report.findings.filter((f) => f.severity === "fail");
    const warns = report.findings.filter((f) => f.severity === "warn");
    expect(fails.length).toBe(1);
    expect(warns.length).toBeGreaterThan(0);
    expect(report.blocked).toBe(true);

    // Same module minus the phantom citation: warnings remain, gate opens.
    const fixed = verifyTier1(mod(text.replace("[8]", "[1]")), SOURCES);
    expect(fixed.blocked).toBe(false);
    expect(fixed.findings.filter((f) => f.severity === "warn").length).toBeGreaterThan(0);
  });
});
