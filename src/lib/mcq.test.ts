import { describe, expect, it } from "vitest";
import { generateMCQ } from "./mcq";

const SAMPLE = `
# MODUL: TEORI ANTROPOLOGI KONTEMPORER

## Konsep Kunci & Definisi
Hegemoni adalah dominasi halus melalui produksi pengetahuan dan kekuasaan.
Poskolonialisme mengkaji dampak kolonialisme pada masyarakat pasca-kolonial.
Feminisme interseksional menyoroti irisan gender, ras, dan kelas dalam opresi.

## Argumen Utama
Sosiologi ruang memandang ruang sebagai konstruksi sosial yang dinamis.
Antropologi kontemporer menolak klaim universalisme Barat yang absolut.
`;

describe("generateMCQ", () => {
  it("produces questions whose answer is among the options", () => {
    const qs = generateMCQ(SAMPLE, 3);
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q.options).toContain(q.answer);
      expect(q.stem).toContain("_____");
      expect(q.options.length).toBe(4);
    }
  });

  it("is deterministic for the same input", () => {
    const a = generateMCQ(SAMPLE, 3);
    const b = generateMCQ(SAMPLE, 3);
    expect(a).toEqual(b);
  });

  it("returns fewer questions when the corpus is too small", () => {
    const qs = generateMCQ("Kalimat pendek. Satu lagi.", 5);
    expect(qs.length).toBeLessThanOrEqual(5);
  });

  it("never builds a card out of a heading (the answer would be in the title)", () => {
    const qs = generateMCQ(SAMPLE, 5);
    for (const q of qs) {
      expect(q.stem).not.toContain("MODUL");
      expect(q.stem).not.toContain("Konsep Kunci");
      expect(q.stem).not.toContain("Argumen Utama");
    }
  });

  it("ignores the bibliography so author names do not become answers", () => {
    const withSources = `${SAMPLE}
Sources:
1. Bourdieu, P. (1977). Outline of a Theory of Practice. Cambridge University Press.
2. Masroer Ch. Jb. (2017). Spiritualitas Islam dalam Budaya Wayang Kulit Jawa dan Sunda.
`;
    for (const q of generateMCQ(withSources, 6)) {
      expect(q.stem).not.toContain("Bourdieu");
      expect(q.stem).not.toContain("Cambridge");
      expect(q.stem).not.toContain("Masroer");
    }
  });

  it("keeps bibliography author/journal terms out of the distractor options (Bug 2.1)", () => {
    const withSources = `${SAMPLE}
Daftar Pustaka:
1. Bourdieu, P. (1977). Outline of a Theory of Practice. Cambridge University Press.
2. Giddens, A. (1984). The Constitution of Society. Journal of Sociology Press.
`;
    for (const q of generateMCQ(withSources, 8)) {
      for (const opt of q.options) {
        expect(opt.toLowerCase()).not.toContain("bourdieu");
        expect(opt.toLowerCase()).not.toContain("cambridge");
        expect(opt.toLowerCase()).not.toContain("giddens");
      }
    }
  });

  it("excludes morphological variants of the answer from the distractors (Bug 2.3)", () => {
    const moduleText = `
## Konsep kunci & definisi
Habitus adalah skema tindakan yang dibentuk oleh sejarah.
Habitualitas menunjukkan pengulangan pola dalam praktik sosial.

## Argumen utama tiap sumber
Habitus memengaruhi cara individu memahami dunia sosial.
Strukturalisme membandingkan habitus dengan struktur sosial yang mendalam.
`;
    for (const q of generateMCQ(moduleText, 4)) {
      // No distractor may share the answer's stem (e.g. "habitualitas" next to "habitus").
      const aStem = q.answer.toLowerCase().slice(0, 5);
      for (const opt of q.options) {
        if (opt === q.answer) continue;
        expect(opt.toLowerCase().slice(0, 5)).not.toBe(aStem);
      }
    }
  });

  it("prefers a frequent key-concept term as the mask over a rare one (Bug 2.2)", () => {
    const moduleText = `
## Konsep kunci & definisi
Habitus adalah skema tindakan yang dibentuk sejarah.
Habitualitas menunjukkan pengulangan pola dalam praktik sosial.

## Argumen utama tiap sumber
Habitus memengaruhi cara individu memahami dunia sosial setiap hari.
Habitus berulang lintas generasi dalam praktik masyarakat.
Strukturalisme membandingkan habitus dengan struktur sosial yang mendalam.
`;
    // "habitus" appears 4× and is declared in Konsep kunci → it must win the mask.
    const qs = generateMCQ(moduleText, 2);
    expect(qs.length).toBeGreaterThan(0);
    expect(qs[0].answer.toLowerCase()).toBe("habitus");
  });

  it("spans multiple distinct concepts instead of repeating one term", () => {
    const moduleText = `
## Konsep kunci & definisi
Hegemoni adalah dominasi halus melalui produksi pengetahuan dan kekuasaan.
Poskolonialisme mengkaji dampak kolonialisme pada masyarakat pasca kolonial.
Feminisme interseksional menyoroti irisan gender ras dan kelas dalam opresi.

## Argumen utama
Hegemoni beroperasi lewat konsensus bukan paksaan terbuka di ruang publik.
Poskolonialisme menolak narasi besar yang dipaksakan oleh pusat kekuasaan.
Feminisme mempertanyakan struktur patriarki yang mengatur pembagian kerja.
`;
    const qs = generateMCQ(moduleText, 5);
    const distinctAnswers = new Set(qs.map((q) => q.answer.toLowerCase()));
    expect(distinctAnswers.size).toBeGreaterThan(1);
  });

  it("draws distractors from the module corpus and keeps them distinct from the answer", () => {
    const moduleText = `
## Konsep kunci & definisi
Hegemoni adalah dominasi halus melalui produksi pengetahuan dan kekuasaan.
Poskolonialisme mengkaji dampak kolonialisme pada masyarakat pasca kolonial.

## Argumen utama
Hegemoni beroperasi lewat konsensus bukan paksaan terbuka di ruang publik.
Poskolonialisme menolak narasi besar yang dipaksakan oleh pusat kekuasaan.
`;
    const corpusWords = new Set(
      moduleText
        .toLowerCase()
        .split(/[^a-zà-ÿ]+/i)
        .filter((w) => w.length >= 5),
    );
    for (const q of generateMCQ(moduleText, 4)) {
      const others = q.options.filter((o) => o !== q.answer);
      expect(others.length).toBeGreaterThanOrEqual(3);
      for (const opt of others) {
        // No distractor may equal the answer or share its morphological stem.
        expect(opt.toLowerCase()).not.toBe(q.answer.toLowerCase());
        expect(opt.toLowerCase().slice(0, 5)).not.toBe(q.answer.toLowerCase().slice(0, 5));
        // Distractors must come from the module's own vocabulary, not random words.
        expect(corpusWords.has(opt.toLowerCase())).toBe(true);
      }
    }
  });

  it("includes an explanation that reconstructs the original sentence", () => {
    const qs = generateMCQ(SAMPLE, 3);
    expect(qs.length).toBeGreaterThan(0);
    for (const q of qs) {
      expect(q.explanation).toBeDefined();
      expect(q.explanation).toContain(q.answer);
      expect(q.explanation).not.toContain("_____");
    }
  });

  it("keeps an inline [n] citation in stem + explanation so the question is grounded to a source", () => {
    const moduleText = `
## Konsep kunci & definisi
Hegemoni adalah dominasi halus melalui produksi pengetahuan dan kekuasaan [1].

## Argumen utama tiap sumber
Poskolonialisme menolak narasi besar yang dipaksakan oleh pusat kekuasaan [2].
Hegemoni beroperasi lewat konsensus bukan paksaan terbuka di ruang publik [1].
`;
    const qs = generateMCQ(moduleText, 3);
    expect(qs.length).toBeGreaterThan(0);
    // Every generated question's stem should carry a [n] source marker, because
    // grounded sentences are preferred over header-style ones.
    for (const q of qs) {
      expect(q.stem).toMatch(/\[\d+\]/);
      expect(q.explanation).toMatch(/\[\d+\]/);
    }
  });
});
