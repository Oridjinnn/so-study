import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { generatePdf, generateWorksheetPdf, hasUnbalancedParens, sanitizeCell } from "./pdf";
import { buildEssayRubric } from "./essay";
import { analyzeModuleContent, deriveStudyGuidance } from "../../app/lib/pdfExtract";
import type { ExportModule } from "./export";

// Strip zero-width joiners/spaces so ligature-guard text round-trips cleanly.
function stripZw(s: string): string {
  return s.replace(/[﻿\u200b\u00ad]/g, "");
}
// Compress all whitespace + joiners so a word split only by a joiner still matches.
function compress(s: string): string {
  return stripZw(s).replace(/\s+/g, "");
}

function makeModule(markdown: string): ExportModule {
  return {
    topicTitle: "Hubungan interaksi antar individu di era modern",
    courseNames: ["Antropologi"],
    generatedAt: "2026-08-21",
    contentMarkdown: markdown,
    sourcePapers: [],
  };
}

describe("sanitizeCell (BUG 3 unit)", () => {
  it("cleans a dangling citation at the end of a table cell", () => {
    expect(sanitizeCell("komunikasi tim [1], [7], [9], [")).toBe("komunikasi tim [1], [7], [9]…");
    expect(sanitizeCell("sudah lengkap [1]")).toBe("sudah lengkap [1]");
    expect(sanitizeCell("tanpa tanda")).toBe("tanpa tanda");
  });
});

describe("PDF generation regression (BUG 3 + BUG 4)", () => {
  it("does not lose fi/fl letters on text extraction (BUG 4)", async () => {
    const md = "definisi konflik fleksibilitas Mengidentifikasi contoh ilustrasi kasus";
    const buf = await generatePdf(makeModule(md));
    const { text } = await new PDFParse({ data: Buffer.from(buf) }).getText();
    const c = compress(text);
    expect(c).toContain("definisi");
    expect(c).toContain("konflik");
    expect(c).toContain("fleksibilitas");
    expect(c).toContain("Mengidentifikasi");
    // The broken/variant spellings the user saw must NEVER appear.
    expect(c).not.toContain("defnisi");
    expect(c).not.toContain("konfik");
    expect(c).not.toContain("feksibilitas");
    expect(c).not.toContain("Mengidentifkasi");
  }, 30000);

  it("no table cell ends with a dangling citation marker (BUG 3)", async () => {
    const md = [
      "## Perbandingan",
      "| Dimensi | Konsep A |",
      "| --- | --- |",
      "| Komunikasi | tim [1], [7], [9], [ |",
    ].join("\n");
    const buf = await generatePdf(makeModule(md));
    const { text } = await new PDFParse({ data: Buffer.from(buf) }).getText();
    const clean = stripZw(text).replace(/\s+/g, " ");
    // Every "[" must have a matching "]" → no dangling marker survives (the
    // sanitized cell ends with an ellipsis, not a half-open bracket).
    const opens = (clean.match(/\[/g) || []).length;
    const closes = (clean.match(/\]/g) || []).length;
    expect(opens).toBe(closes);
  }, 30000);

  it("renders Contoh/Refleksi paragraphs as distinct callouts (layout polish)", async () => {
    const md = [
      "## Konsep kunci & definisi",
      "### Interaksi sosial",
      "Interaksi sosial adalah hubungan antar individu.",
      "",
      "Contoh konkret: Dua orang bertukar pesan melalui media sosial untuk menjaga keharmonisan.",
      "",
      "Pertanyaan refleksi: Apa yang membuat interaksi ini berbeda dari sekadar komunikasi satu arah?",
    ].join("\n");
    const buf = await generatePdf(makeModule(md));
    const { text } = await new PDFParse({ data: Buffer.from(buf) }).getText();
    const clean = compress(text);
    expect(clean).toContain("Contohkonkret");
    expect(clean).toContain("Pertanyaanrefleksi");
  }, 30000);
});

// ---------------------------------------------------------------------------
// Worksheet/reading PDF must never print a truncated concept fragment such as
// "Aktor Selain Negara (Non" — the exact corruption reported on the worksheet
// PDF. The module below reproduces the failing shape: a "Konsep kunci" section
// written as a FLAT NUMBERED LIST (no `###` sub-headings), which is the layout
// that previously atomised each entry into garbage.
// ---------------------------------------------------------------------------
const NUMBERED_MODULE = [
  "# Modul: Tingkatan Aktor dan Level Hukum yang Terikat pada Aktor",
  "",
  "## Konsep kunci & definisi",
  "",
  "1. **Aktor Selain Negara (Non-State Armed Groups)**: kelompok bersenjata di luar struktur negara yang tetap terikat aturan hukum humaniter.",
  "2. **Pemetaan Jaringan Aktor (Actor-Network Mapping)**: pendekatan yang melihat aktor sebagai simpul dalam jaringan relasi.",
  "3. **Birokrasi Tingkat Tapak (Street-Level Bureaucracy)**: aparatur lapangan yang menerjemahkan kebijakan ke dalam praktik.",
  "4. **Hukum Humaniter Internasional**: aturan yang membatasi cara berperang dan melindungi korban konflik.",
  "5. **Akuntabilitas Vertikal dan Horizontal**: pertanggungjawaban aktor kepada atasan dan kepada publik.",
  "6. **Norma yang Mengikat (Binding Norms)**: kaidah yang secara hukum mewajibkan aktor tertentu.",
  "",
  "## Argumen",
  "- Aktor non-negara tetap tunduk pada hukum humaniter meski bukan pihak negara.",
  "- Pemetaan jaringan menjelaskan mengapa kepatuhan hukum sering tidak merata.",
].join("\n");

function buildExportModule(markdown: string, essayPrompt = "Tulis esai berdasarkan modul ini."): ExportModule {
  const analysis = analyzeModuleContent(markdown);
  return {
    topicTitle: "Tingkatan Aktor dan Level Hukum",
    courseNames: ["Hukum Humaniter"],
    generatedAt: "2026-08-24",
    contentMarkdown: markdown,
    sourcePapers: [],
    studyGuidance: deriveStudyGuidance(analysis, essayPrompt),
    essayRubric: buildEssayRubric(markdown),
    essayPrompt,
  };
}

describe("worksheet/reading PDF must not print truncated concepts (BUG reported)", () => {
  it("numbered concept list renders as clean, whole terms in BOTH PDFs", async () => {
    const mod = buildExportModule(NUMBERED_MODULE);
    for (const [name, render] of [
      ["reading", generatePdf],
      ["worksheet", generateWorksheetPdf],
    ] as const) {
      const buf = await render(mod);
      const { text } = await new PDFParse({ data: Buffer.from(buf) }).getText();
      const clean = compress(text);
      // The whole, balanced concept terms must appear...
      expect(clean, `${name}: expects whole concept`).toContain(
        "AktorSelainNegara(Non-StateArmedGroups)",
      );
      expect(clean, `${name}: expects whole concept`).toContain(
        "PemetaanJaringanAktor(Actor-NetworkMapping)",
      );
      // ...and the document as a whole must carry NO unbalanced parenthesis —
      // the precise signature of the reported "(Non" / "(Actor" corruption.
      expect(hasUnbalancedParens(text), `${name}: must not contain unbalanced parens`).toBe(false);
    }
  }, 30000);

  it("guard substitutes a clean rubric + drops a corrupted guidance line", async () => {
    const mod: ExportModule = {
      topicTitle: "Modul rusak (data pra-perbaikan)",
      courseNames: ["Hukum"],
      generatedAt: "2026-08-20",
      contentMarkdown: "",
      sourcePapers: [],
      // A guidance line and a rubric line written before the extractor was
      // hardened — dangling open parens, exactly the reported corruption.
      studyGuidance: [
        "Sebelum membuka sumber, jelaskan: Aktor Selain Negara (Non",
        "Susun bukti → analisis → kesimpulan.",
      ],
      essayRubric:
        "Rubrik esai:\nB. Penafsiran:\n  - Menafsirkan konsep kunci \"Aktor Selain Negara (Non\" secara akurat.",
      essayPrompt: "Tulis esai.",
    };
    const buf = await generateWorksheetPdf(mod);
    const { text } = await new PDFParse({ data: Buffer.from(buf) }).getText();
    const clean = compress(text);
    // Corrupted fragments must be gone, while a clean line is kept...
    expect(clean, "corrupted guidance dropped").not.toContain("AktorSelainNegara(Non");
    expect(clean, "clean guidance kept").toContain("Susunbukti");
    expect(clean, "corrupted rubric dropped").not.toContain("AktorSelainNegara(Non");
    // ...and the corrupted rubric is replaced by the clean fallback.
    expect(clean, "fallback rubric present").toContain("Menyimpulkanrelevansitopik");
    expect(hasUnbalancedParens(text), "no unbalanced parens after guard").toBe(false);
  }, 30000);
});
