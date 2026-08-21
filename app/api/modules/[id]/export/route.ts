import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { generateMCQ } from "@/src/lib/mcq";
import { generatePdf } from "@/src/lib/pdf";
import type { PaperType } from "@/src/lib/sources/types";
import {
  type ExportCard,
  type ExportModule,
  contentTypeFor,
  enrichModule,
  exportFilename,
  parseExportFormat,
  toAnkiTSV,
  toMarkdown,
} from "@/src/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Export a stored module for offline/portable study (roadmap Phase 3).
//
// Contract (I3): GET /api/modules/[id]/export?format=md|anki|pdf
//   200 -> file download (Content-Disposition: attachment)
//   400 -> unknown format
//   404 -> module not found
// Read-only: no writes, no LLM call, no cost. `pdf` is generated here on the
// server (a real downloadable file, not the browser's print dialog) so it works
// directly on iPad Safari without the hidden "Save as PDF" pinch gesture.

/**
 * Anki cards come from the student's question bank first (generation effect —
 * self-authored cards are what we want in their long-term deck). When the bank
 * is empty we fall back to the DETERMINISTIC cloze generator, so an export
 * always succeeds without spending an API call.
 */
async function collectCards(topicId: string, contentMarkdown: string): Promise<ExportCard[]> {
  const bank = await prisma.questionBankItem.findMany({
    where: { topicId },
    orderBy: { createdAt: "asc" },
  });

  const fromBank: ExportCard[] = [];
  for (const item of bank) {
    let options: string[] = [];
    try {
      const parsed = JSON.parse(item.options);
      if (Array.isArray(parsed)) options = parsed.filter((o): o is string => typeof o === "string");
    } catch {
      options = []; // a malformed row still exports as a plain front/back card
    }
    fromBank.push({
      stem: item.stem,
      options,
      answer: item.answer,
      explanation: item.explanation,
    });
  }
  if (fromBank.length > 0) return fromBank;

  return generateMCQ(contentMarkdown, 10).map((q) => ({
    stem: q.stem,
    options: q.options,
    answer: q.answer,
    explanation: q.explanation ?? null,
  }));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const format = parseExportFormat(req.nextUrl.searchParams.get("format"));
  if (!format) {
    return NextResponse.json(
      { error: "Query param 'format' harus 'md', 'anki', atau 'pdf'." },
      { status: 400 },
    );
  }

  const mod = await prisma.module.findUnique({
    where: { id },
    include: { topic: true, courses: { include: { course: true } } },
  });
  if (!mod) {
    return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });
  }

  // Grounding sources are needed by both the `md` and `pdf` formats, so resolve
  // them once. An unparseable list falls back to no appendix rather than 500ing.
  let paperIds: string[] = [];
  try {
    paperIds = JSON.parse(mod.sourcePaperIds || "[]");
  } catch {
    paperIds = [];
  }
  const fetched = paperIds.length
    ? await prisma.paper.findMany({ where: { id: { in: paperIds } } })
    : [];
  const byId = new Map(fetched.map((p) => [p.id, p]));
  const papers = paperIds
    .map((pid) => byId.get(pid))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const exportModule: ExportModule = {
    topicTitle: mod.topic.title,
    courseNames: mod.courses.map((c) => c.course.name),
    generatedAt: mod.generatedAt,
    contentMarkdown: mod.contentMarkdown,
    essayPrompt: mod.essayPrompt,
    essayRubric: mod.essayRubric,
    sourcePapers: papers.map((p) => ({
      title: p.title,
      authors: p.authors,
      year: p.year,
      sourceUrl: p.sourceUrl,
      citationCount: p.citationCount,
      // Bibliographic metadata drives the APA-7 references in the md/pdf
      // appendix (src/lib/citation.ts). Absent values stay null: the formatter
      // then falls back to the shorter reference form rather than inventing a
      // venue or publisher (I5).
      doi: p.doi ?? null,
      venue: p.venue ?? null,
      volume: p.volume ?? null,
      issue: p.issue ?? null,
      pages: p.pages ?? null,
      publisher: p.publisher ?? null,
      type: (p.type as PaperType | null) ?? null,
    })),
  };

  if (format === "anki") {
    const cards = await collectCards(mod.topicId, mod.contentMarkdown);
    const body = toAnkiTSV(cards, mod.topic.title);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(format),
        "Content-Disposition": `attachment; filename="${exportFilename(mod.topic.title, format)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "pdf") {
    // Enrich with derived guidance / concepts / rubric sections so the export
    // reflects a real reading of the module, not a raw text dump.
    const pdf = await generatePdf(enrichModule(exportModule));
    // Copy into a plain ArrayBuffer: the TS DOM lib types reject the generic
    // `Uint8Array<ArrayBufferLike>` from pdfmake as a `BlobPart`/`BodyInit`.
    const ab = new ArrayBuffer(pdf.byteLength);
    new Uint8Array(ab).set(pdf);
    return new NextResponse(new Blob([ab]), {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(format),
        "Content-Disposition": `attachment; filename="${exportFilename(mod.topic.title, format)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const body = toMarkdown(exportModule);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(format),
      "Content-Disposition": `attachment; filename="${exportFilename(mod.topic.title, format)}"`,
      "Cache-Control": "no-store",
    },
  });
}
