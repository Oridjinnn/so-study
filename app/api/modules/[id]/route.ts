import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { notFoundForUser, requireUser } from "@/src/lib/tenancy";
import { verificationPayload } from "@/src/lib/verification";
import type { PaperType } from "@/src/lib/sources/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `[id]` is user input straight off the URL (data-security.md: "Folders with
// brackets are user input"), so both handlers here resolve the caller from the
// signed cookie themselves and fold `ownerId` into the module lookup. The edge
// gate in proxy.ts only proves SOMEBODY is logged in — it cannot know whose
// module this id is.

// Delete a module AND its topic (with all papers, sessions, attempts, question
// bank items, versions, chunks and excerpts). The Topic→Module→all cascade in
// prisma/schema.prisma makes this a single delete of the topic; we delete the
// topic so the whole study trail for this topic is gone, matching the
// confirmation dialog ("Topik, paper, dan seluruh riwayatnya ikut terhapus").
export async function DELETE(req: Request, ctx: RouteContext<"/api/modules/[id]">) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const { id } = await ctx.params;
  // findFirst({ id, ownerId }), never findUnique({ id }): the owner is folded
  // into the lookup this handler already had to run, so "does not exist" and
  // "is not yours" collapse into one query and one 404 — a 403 here would
  // confirm that a guessed module id is real.
  const mod = await prisma.module.findFirst({
    where: { id, ownerId },
    select: { topicId: true },
  });
  if (!mod) return notFoundForUser("Modul");
  // deleteMany rather than delete, so `ownerId` travels into the DESTRUCTIVE
  // statement too. The cascade behind this call erases a whole topic's study
  // trail; making it unconditional on a second query's result is how a future
  // refactor would quietly hand it someone else's row.
  await prisma.topic.deleteMany({ where: { id: mod.topicId, ownerId } });
  return NextResponse.json({ ok: true });
}

// Read-only module detail for the UI: content + source papers (grounding) +
// version history. Serves the reader / sources views (no writes here).
export async function GET(req: Request, ctx: RouteContext<"/api/modules/[id]">) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const { id } = await ctx.params;
  const mod = await prisma.module.findFirst({
    // Same fold as DELETE: the versions and course links come back through the
    // relation from a row that is already proven to be the caller's, so no
    // nested include needs its own owner filter.
    where: { id, ownerId },
    include: {
      topic: true,
      versions: { orderBy: { version: "desc" } },
      courses: { include: { course: true } },
    },
  });
  if (!mod) return notFoundForUser("Modul");
  let paperIds: string[] = [];
  try {
    paperIds = JSON.parse(mod.sourcePaperIds || "[]");
  } catch {
    paperIds = [];
  }
  // Paper is deliberately GLOBAL and deduplicated across users (schema: no
  // ownerId, `sourceUrl @unique`) — it is public bibliographic metadata and
  // holds nothing private. Scoping it would be theatre; what matters is that
  // `paperIds` came off a module already proven to belong to this caller.
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
