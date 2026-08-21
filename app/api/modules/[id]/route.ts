import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { verificationPayload } from "@/src/lib/verification";
import type { PaperType } from "@/src/lib/sources/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Delete a module AND its topic (with all papers, sessions, attempts, question
// bank items, versions, chunks and excerpts). The Topic→Module→all cascade in
// prisma/schema.prisma makes this a single delete of the topic; we delete the
// topic so the whole study trail for this topic is gone, matching the
// confirmation dialog ("Topik, paper, dan seluruh riwayatnya ikut terhapus").
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const mod = await prisma.module.findUnique({ where: { id } });
  if (!mod) {
    return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });
  }
  await prisma.topic.delete({ where: { id: mod.topicId } });
  return NextResponse.json({ ok: true });
}

// Read-only module detail for the UI: content + source papers (grounding) +
// version history. Serves the reader / sources views (no writes here).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const mod = await prisma.module.findUnique({
    where: { id },
    include: {
      topic: true,
      versions: { orderBy: { version: "desc" } },
      courses: { include: { course: true } },
    },
  });
  if (!mod) {
    return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });
  }
  let paperIds: string[] = [];
  try {
    paperIds = JSON.parse(mod.sourcePaperIds || "[]");
  } catch {
    paperIds = [];
  }
  const fetched = paperIds.length
    ? await prisma.paper.findMany({ where: { id: { in: paperIds } } })
    : [];
  // Preserve the sourcePaperIds order so inline citations [n] map to the
  // paper the synthesis prompt numbered as Paper n.
  const byId = new Map(fetched.map((p) => [p.id, p]));
  const papers = paperIds.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  return NextResponse.json({
    id: mod.id,
    topicId: mod.topicId,
    topicTitle: mod.topic.title,
    contentMarkdown: mod.contentMarkdown,
    generatedAt: mod.generatedAt,
    wordCount: mod.wordCount,
    pageCount: mod.pageCount,
    essayPrompt: mod.essayPrompt,
    essayRubric: mod.essayRubric,
    // Two-tier accuracy verification, read from the cache written at synthesis
    // (and refreshed by the verify/repair routes). Tier 2 is never run on a
    // read — that is the whole point of caching it on the row. `gauge` is null
    // until Tier 1 has run, so an unverified module renders as "belum
    // diperiksa" instead of as a clean score.
    verification: verificationPayload(mod),
    courses: mod.courses.map((c) => ({ id: c.course.id, name: c.course.name })),
    sourcePapers: papers.map((p) => ({
      id: p.id,
      title: p.title,
      authors: p.authors,
      year: p.year,
      citationCount: p.citationCount,
      sourceUrl: p.sourceUrl,
      // Bibliographic metadata for APA-7 references (src/lib/citation.ts).
      // Normalised to null so the DTO never carries `undefined` through JSON.
      doi: p.doi ?? null,
      venue: p.venue ?? null,
      volume: p.volume ?? null,
      issue: p.issue ?? null,
      pages: p.pages ?? null,
      publisher: p.publisher ?? null,
      type: (p.type as PaperType | null) ?? null,
    })),
    versions: mod.versions.map((v) => ({
      id: v.id,
      version: v.version,
      generatedAt: v.generatedAt,
      changeNote: v.changeNote,
    })),
  });
}
