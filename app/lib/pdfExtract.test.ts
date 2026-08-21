import { describe, expect, it } from "vitest";
import { extractPdfText } from "./pdfExtract";

// Build a minimal valid PDF whose only content stream carries one text line.
// Used to prove the real pdf-parse integration extracts text (the DOM test for
// RPSReconcilePanel mocks this module; this test runs the real parser).
function buildSamplePdf(): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 64 >>\nstream\nBT /F1 12 Tf 72 720 Td (Kalender Akademik 2026 - Teori A) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  const count = objs.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += xref;
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

function makeFile(): File {
  return new File([buildSamplePdf() as BlobPart], "kalender.pdf", { type: "application/pdf" });
}

describe("extractPdfText", () => {
  it("extracts text from a real PDF buffer for review", async () => {
    const text = await extractPdfText(makeFile());
    expect(text).toContain("Kalender Akademik 2026");
  }, 20000);
});
