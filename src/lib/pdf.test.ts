import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import { generatePdf, sanitizeCell } from "./pdf";
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
