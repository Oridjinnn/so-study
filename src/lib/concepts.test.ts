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

// The SHAPE the user's failing module actually used: the synthesis contract asks
// for one "### Nama Konsep" sub-section per concept, but the AI instead wrote
// "## Konsep Kunci & Definisi" followed by a FLAT numbered list
// ("1. **Nama**: definisi" … "10. Nama: definisi") with NO sub-headings. The
// previous pass atomised those list items at commas/parens, so the PDF intro,
// essay Bagaimana question and rubric showed garbage like
// "Aktor Selain Negara (Non" and "Pemetaan Jaringan Aktor (Actor". This pins the
// numbered-list path: each entry must become ONE clean term.
const NUMBERED_MODULE = `## Tujuan Pembelajaran

Setelah membaca modul ini, kamu bisa membedakan tingkatan aktor dan level hukum.

## Konsep kunci & definisi

Untuk memahami lanskap hukum, kita perlu memetakan aktor berdasarkan tingkatan.

1. *Aktor Selain Negara (Non-State Armed Groups) dalam Hukum Humaniter*: Kelompok bersenjata non-pemerintah [4].
2. Aktor Hibrida & Sinergi Masyarakat Sipil-Pemerintah: Kolaborasi antara CSO dan negara [5].
3. Aktor Negara dalam Rezim Iklim Global: Peran negara sebagai aktor utama [9].
4. Jaringan Aktor Bisnis Sub-Nasional: Kelompok usaha lokal [1].
5. *Pemetaan Jaringan Aktor (Actor-Network Mapping)*: Metodologi analisis HI [2].
6. Birokrasi Pelayanan Publik Digital: Transformasi aktor negara [3].

## Argumen utama tiap sumber

- Negara tidak memonopoli otoritas di ruang non-state [1].
`;

describe("extractKeyConcepts on the numbered-list '## Konsep' shape", () => {
  const concepts = extractKeyConcepts(NUMBERED_MODULE, 6);

  it("reads every numbered entry as one clean term (no comma/paren fragments)", () => {
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts).toContain("Aktor Selain Negara (Non-State Armed Groups) dalam Hukum Humaniter");
    expect(concepts).toContain("Aktor Hibrida & Sinergi Masyarakat Sipil-Pemerintah");
    expect(concepts).toContain("Aktor Negara dalam Rezim Iklim Global");
    expect(concepts).toContain("Pemetaan Jaringan Aktor (Actor-Network Mapping)");
    // The lead-in prose is connective tissue, never a concept.
    expect(concepts.some((c) => c.toLowerCase().startsWith("untuk"))).toBe(false);
  });

  it("strips the ordinal and emphasis but keeps balanced parenthetical glosses", () => {
    for (const c of concepts) {
      expect(c).not.toMatch(/^\d+\./); // no "1." ordinal leak
      expect(c).not.toMatch(/[*_]/); // no dangling emphasis markers
      // every parenthetical is balanced — never the truncated "(Non" / "(Actor"
      const opens = (c.match(/\(/g) || []).length;
      const closes = (c.match(/\)/g) || []).length;
      expect(opens).toBe(closes);
    }
  });

  it("feeds clean concepts to the PDF intro + rubric (no garbage)", () => {
    const analysis = analyzeModuleContent(NUMBERED_MODULE);
    expect(analysis.keyConcepts).toContain("Aktor Selain Negara (Non-State Armed Groups) dalam Hukum Humaniter");

    const guidance = deriveStudyGuidance(analysis, "Tulis esai tentang aktor.");
    const intro = guidance.join(" ");
    // The corrupted export read "Aktor Selain Negara (Non, Aktor Hibrida …" — a
    // paren opened inside a concept but never closed. Every paren in the intro
    // must now be balanced, and the clean concept present.
    const opens = (intro.match(/\(/g) || []).length;
    const closes = (intro.match(/\)/g) || []).length;
    expect(opens).toBe(closes);
    expect(intro).toContain("Aktor Selain Negara (Non-State Armed Groups)");

    const rubric = buildEssayRubric(NUMBERED_MODULE);
    expect(rubric).toMatch(/Aktor Selain Negara \(Non-State Armed Groups\) dalam Hukum Humaniter/);
    const rOpens = (rubric.match(/\(/g) || []).length;
    const rCloses = (rubric.match(/\)/g) || []).length;
    expect(rOpens).toBe(rCloses);
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

// The shape that actually shipped for the "tingkatan aktor" module: the AI wrote
// "## Konsep kunci & definisi" as a series of BOLD lead-in paragraphs
// ("*Nama Konsep (English)*: definisi") with NO `###` sub-headings and NO
// numbered list. The prior pass fell through to the prose/run-on branch and
// atomised each bold term at commas / "&" / "dan", so the rubric cited garbage
// like "Aktor Non-Negara Lokal dan", "Masyarakat Digital dan Pelayanan" and
// "Local Non-State Actors &". This pins the bold-paragraph path: each bold term
// becomes ONE clean (Indonesian) concept, with the English gloss dropped.
const BOLD_MODULE = `## Tujuan Pembelajaran

Setelah membaca modul ini, kamu bisa membedakan tingkatan aktor dan level hukum.

## Konsep kunci & definisi

*Aktor Non-Negara Lokal dan Jaringan Komunikasi (Local Non-State Actors & Communication Networks)*: Entitas non-pemerintah berbasis lokal yang membentuk jaringan komunikasi horizontal.
*Tata Kelola Banyak Tingkat (Multi-Level Governance & Actor Mapping)*: Kerangka analisis HI yang memetakan hubungan antar-aktor.
*Masyarakat Digital dan Pelayanan Publik (Digital Society & Public Service Governance)*: Redefinisi kewajiban aktor negara.
*Aktor Bersenjata Non-Negara dalam Hukum Humaniter Internasional (Non-State Armed Actors in IHL)*: Subjek hukum internasional terbatas.
*Sinergi Aktor Lingkungan (Environmental Governance Synergy)*: Kolaborasi institusional antara OMS/NGO dan pemerintah.
*Diskresi Birokrat Tingkat Bawah (Street-Level Bureaucratic Discretion)*: Peran agen individu di tingkat birokrasi pelaksana.

## Penjelasan Mendalam Konsep Kunci

Aktor ekonomi lokal dapat bertindak sebagai non-state actors [1].
`;

describe("extractKeyConcepts on the bold-paragraph '## Konsep' shape", () => {
  const concepts = extractKeyConcepts(BOLD_MODULE, 6);

  it("reads every bold lead-in as one clean concept (no comma/&/dan fragments)", () => {
    expect(concepts.length).toBeGreaterThan(0);
    expect(concepts).toContain("Aktor Non-Negara Lokal dan Jaringan Komunikasi");
    expect(concepts).toContain("Tata Kelola Banyak Tingkat");
    expect(concepts).toContain("Masyarakat Digital dan Pelayanan Publik");
    expect(concepts).toContain("Aktor Bersenjata Non-Negara dalam Hukum Humaniter Internasional");
    expect(concepts).toContain("Sinergi Aktor Lingkungan");
    expect(concepts).toContain("Diskresi Birokrat Tingkat Bawah");
  });

  it("drops the parenthetical English gloss and keeps terms whole", () => {
    for (const c of concepts) {
      expect(c).not.toMatch(/[&]/); // "Local Non-State Actors &" type fragments gone
      expect(c).not.toMatch(/\(/); // no dangling/embedded paren gloss
      expect(c).not.toMatch(/setelah membaca modul ini/i);
    }
  });

  it("feeds clean concepts to the rubric (no truncated garbage)", () => {
    const rubric = buildEssayRubric(BOLD_MODULE);
    expect(rubric).toMatch(/Aktor Non-Negara Lokal dan Jaringan Komunikasi/);
    expect(rubric).not.toMatch(/Aktor Non-Negara Lokal dan"/); // not "… Lokal dan"
    expect(rubric).not.toMatch(/Masyarakat Digital dan Pelayanan"/); // not "… Pelayanan"
    expect(rubric).not.toMatch(/Local Non-State Actors &/);
  });
});
