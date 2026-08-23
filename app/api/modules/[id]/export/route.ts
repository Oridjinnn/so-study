import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { notFoundForUser, requireUser } from "@/src/lib/tenancy";
import { generateMCQ } from "@/src/lib/mcq";
import { generatePdf, generateWorksheetPdf } from "@/src/lib/pdf";
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
//   401 -> no (or invalid) session
//   404 -> module not found, or not this student's module
// Read-only: no writes, no LLM call, no cost. `pdf` is generated here on the
// server (a real downloadable file, not the browser's print dialog) so it works
// directly on iPad Safari without the hidden "Save as PDF" pinch gesture.
//
// A download is exactly the shape of leak that goes unnoticed: the response is a
// file, not a screen, so nobody would spot the other student's module inside it.
// Hence the owner is folded into the module lookup, and the question bank the
// Anki deck is built from is scoped through its topic.

/**
 * Anki cards come from the student's question bank first (generation effect —
 * self-authored cards are what we want in their long-term deck). When the bank
 * is empty we fall back to the DETERMINISTIC cloze generator, so an export
 * always succeeds without spending an API call.
 */
async function collectCards(
  topicId: string,
  ownerId: string,
  contentMarkdown: string,
): Promise<ExportCard[]> {
  const bank = await prisma.questionBankItem.findMany({
    // QuestionBankItem has no owner column; it is reachable only through its
    // Topic, so that is where the filter goes. The topicId already came from an
    // owner-checked module — this is the belt to that braces, and it keeps the
    // rule ("every read is scoped") true by inspection of this one query.
    where: { topicId, topic: { ownerId } },
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

export async function GET(req: NextRequest, ctx: RouteContext<"/api/modules/[id]/export">) {
  // Auth first: an anonymous caller must not even reach the format parser, let
  // alone a DB round-trip.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const { id } = await ctx.params;

  const format = parseExportFormat(req.nextUrl.searchParams.get("format"));
  if (!format) {
    return NextResponse.json(
      { error: "Query param 'format' harus 'md', 'anki', 'pdf', atau 'pdf-worksheet'." },
      { status: 400 },
    );
  }

  const mod = await prisma.module.findFirst({
    where: { id, ownerId },
    include: { topic: true, courses: { include: { course: true } } },
  });
  if (!mod) return notFoundForUser("Modul");

  // Grounding sources are needed by both the `md` and `pdf` formats, so resolve
  // them once. An unparseable list falls back to no appendix rather than 500ing.
  let paperIds: string[] = [];
  try {
    paperIds = JSON.parse(mod.sourcePaperIds || "[]");
  } catch {
    paperIds = [];
  }
  // Paper is global by design (deduplicated across users, no private fields), so
  // only the join is owner-scoped — and here the ids come from a module already
  // proven to be the caller's.
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
    const cards = await collectCards(mod.topicId, ownerId, mod.contentMarkdown);
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

  if (format === "pdf" || format === "pdf-worksheet") {
    // Enrich with derived guidance / concepts / rubric sections so the export
    // reflects a real reading of the module, not a raw text dump.
    // `pdf` = module content + sources (reading material);
    // `pdf-worksheet` = essay question + 5W1H guidance + rubric only (exercise
    // sheet), generated as a separate download.
    const enriched = enrichModule(exportModule);
    const pdf =
      format === "pdf-worksheet"
        ? await generateWorksheetPdf(enriched)
        : await generatePdf(enriched);
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
