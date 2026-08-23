import { describe, expect, it } from "vitest";
import { extractKeyConcepts, stripModuleBoilerplate } from "./concepts";
import { buildEssayRubric, generateEssayPromptHarness } from "./essay";
import { analyzeModuleContent, deriveStudyGuidance } from "@/app/lib/pdfExtract";

// Regression fixture: reconstructs the structure that produced the corrupted
// "key concepts" export (three surfaces — PDF intro, essay Bagaimana question,
// rubric — all showing template/run-on garbage such as
// "Setelah membaca modul ini," and "Dalam penataan ranah Hubungan, Aktor
// Bersenjata Selain Negara, … Birokrat Tingkat Tapak (*Street,").
const CORRUPTED_MODULE = `## Tujuan Pembelajaran

Setelah membaca modul ini, kamu bisa membedakan tingkatan aktor dan level hukum yang terikat pada aktor.

## Konsep kunci & definisi

Dalam penataan ranah Hubungan, Aktor Bersenjata Selain Negara, Aktor Pemerintah dan Organisasi, Birokrat Tingkat Tapak (Street-level bureaucracy) adalah aktor yang beroperasi di tingkat lokal.

- Aktor Bersenjata Selain Negara: kelompok bersenjata di luar struktur negara.
- Aktor Pemerintah dan Organisasi: lembaga formal pengambil kebijakan.
- Setelah membaca modul ini, kamu bisa mengidentifikasi birokrat tapak.

## Argumen utama tiap sumber

- Negara tidak monopoli otoritas di ruang non-state.
`;

const TITLE = "Tingkatan Aktor dan Level Hukum";

describe("extractKeyConcepts (Bug 1 regression)", () => {
  it("never mines template lead-ins like 'Setelah membaca modul ini'", () => {
    const concepts = extractKeyConcepts(CORRUPTED_MODULE);
    expect(concepts.some((c) => /setelah membaca modul ini/i.test(c))).toBe(false);
    expect(concepts.some((c) => c.toLowerCase().startsWith("setelah"))).toBe(false);
    expect(concepts.some((c) => c.toLowerCase().startsWith("dalam"))).toBe(false);
  });

  it("recovers real concepts from a comma-joined run-on instead of one garbage blob", () => {
    const concepts = extractKeyConcepts(CORRUPTED_MODULE);
    expect(concepts).toContain("Aktor Bersenjata Selain Negara");
    expect(concepts).toContain("Aktor Pemerintah dan Organisasi");
  });

  it("does not truncate mid-word inside an unbalanced markdown/bracket fragment", () => {
    const concepts = extractKeyConcepts(CORRUPTED_MODULE);
    expect(concepts.some((c) => c.includes("Street") || c.includes("(*"))).toBe(false);
  });

  it("strips the Tujuan Pembelajaran section before mining", () => {
    const stripped = stripModuleBoilerplate(CORRUPTED_MODULE);
    expect(stripped).not.toMatch(/##\s*Tujuan Pembelajaran/i);
    // The whole template section (heading + "kamu bisa membedakan …" body) is gone.
    expect(stripped).not.toMatch(/kamu bisa membedakan tingkatan aktor/i);
  });
});

describe("essay harness (Bug 1 regression)", () => {
  it("essay question never embeds the template lead-in", () => {
    const q = generateEssayPromptHarness(CORRUPTED_MODULE, TITLE);
    expect(q).not.toMatch(/setelah membaca modul ini/i);
  });

  it("rubric never asks to interpret a template fragment as a concept", () => {
    const r = buildEssayRubric(CORRUPTED_MODULE);
    expect(r).not.toMatch(/setelah membaca modul ini/i);
  });
});

// The REAL shape every module is generated in: the synthesis contract
// (app/api/synthesize/route.ts) requires "## Konsep kunci & definisi" with one
// "### Nama Konsep" sub-section PER concept. An earlier fix mined only the
// section's loose prose and stopped at the first sub-heading, so on this — the
// only shape that ships — it returned ZERO concepts: no garbage, but also no
// concept list in the PDF intro, the essay question or the rubric. These tests
// pin BOTH halves: concepts are non-empty AND free of template boilerplate.
const REAL_MODULE = `## Tujuan Pembelajaran

- Setelah membaca modul ini, kamu bisa: membedakan tingkatan aktor dan level hukum.
- Setelah membaca modul ini, kamu bisa: menjelaskan peran birokrat tapak.

## Mengapa topik ini penting

Topik ini penting karena aktor non-negara makin menentukan implementasi norma [1].

## Konsep kunci & definisi

### Aktor Bersenjata Selain Negara

Aktor Bersenjata Selain Negara adalah kelompok bersenjata di luar struktur negara [1].

Contoh konkret: milisi lokal yang menguasai wilayah perbatasan [1].

### Birokrat Tingkat Tapak (*Street-Level Bureaucrat*)

Birokrat Tingkat Tapak adalah pelaksana kebijakan di garis depan [2].

Pertanyaan refleksi: siapa yang benar-benar memutuskan di lapangan?

### Level Hukum Domestik — penjelasan bertingkat

Level hukum domestik mengikat aktor melalui peraturan turunan [2].

## Argumen utama tiap sumber

- Negara tidak memonopoli otoritas di ruang non-state [1].
`;

describe("extractKeyConcepts on the real mandated ### structure", () => {
  const concepts = extractKeyConcepts(REAL_MODULE, 6);

  it("returns non-empty concepts read from the '### Nama Konsep' sub-headings", () => {
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts).toContain("Aktor Bersenjata Selain Negara");
    expect(concepts).toContain("Birokrat Tingkat Tapak");
    // "### Nama Konsep — penjelasan": only the term side becomes the concept.
    expect(concepts).toContain("Level Hukum Domestik");
  });

  it("never leaks the template lead-in or a broken markdown fragment", () => {
    for (const c of concepts) {
      expect(c).not.toMatch(/setelah membaca modul ini/i);
      expect(c).not.toMatch(/^(setelah|topik|dalam|contoh|pertanyaan)\b/i);
      expect(c).not.toMatch(/[*_[]|\(\s*$/); // no dangling markdown/bracket ("(*Street,")
      expect(c).not.toMatch(/Street/); // the parenthetical gloss is dropped whole
    }
  });

  it("does not mine explanation body text ('Contoh konkret', 'Pertanyaan refleksi') as concepts", () => {
    expect(concepts.some((c) => /contoh konkret|pertanyaan refleksi|adalah/i.test(c))).toBe(false);
  });

  it("feeds real concepts to all three consumers (PDF intro, essay question, rubric)", () => {
    const analysis = analyzeModuleContent(REAL_MODULE);
    expect(analysis.keyConcepts).toContain("Aktor Bersenjata Selain Negara");

    const guidance = deriveStudyGuidance(analysis, "Tulis esai tentang aktor.");
    const intro = guidance.join(" ");
    expect(intro).toContain("Aktor Bersenjata Selain Negara");
    expect(intro).not.toMatch(/setelah membaca modul ini/i);
    expect(intro).not.toMatch(/\(\*/); // the exact corrupted-export pattern

    const question = generateEssayPromptHarness(REAL_MODULE, TITLE);
    expect(question).not.toMatch(/setelah membaca modul ini/i);

    const rubric = buildEssayRubric(REAL_MODULE);
    expect(rubric).toMatch(/Aktor Bersenjata Selain Negara/);
    expect(rubric).not.toMatch(/setelah membaca modul ini/i);
  });
});
