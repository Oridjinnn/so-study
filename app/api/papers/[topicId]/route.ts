import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireUser, notFoundForUser } from "@/src/lib/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Candidate papers for a topic, with their human approval state. Drives the
// review/approval bottom sheet before synthesis.
//
// Tenancy: a `TopicPaper` is reachable only THROUGH its topic, so we scope the
// join with `where: { topicId, topic: { ownerId } }`. A topic that does not
// exist or belongs to another student simply yields an empty list — never a
// 403, which would confirm the id is real.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> },
) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const { topicId } = await params;
  const rows = await prisma.topicPaper.findMany({
    where: { topicId, topic: { ownerId } },
    include: { paper: true },
    orderBy: { paper: { relevanceScore: "desc" } },
  });
  const papers = rows.map((tp) => ({
    id: tp.paper.id,
    title: tp.paper.title,
    authors: tp.paper.authors,
    year: tp.paper.year,
    abstract: tp.paper.abstract,
    citationCount: tp.paper.citationCount,
    relevanceScore: tp.paper.relevanceScore,
    sourceUrl: tp.paper.sourceUrl,
    fullTextAvailable: tp.paper.fullTextAvailable,
    doi: tp.paper.doi ?? null,
    approved: tp.approved,
  }));
  return NextResponse.json({ topicId, papers });
}

// Set the approved subset for a topic. Any paper id NOT in `approvedPaperIds`
// is marked unapproved — this is the human gate that synthesis enforces.
//
// Tenancy: same `topic: { ownerId }` join scoping on the read, plus an explicit
// owner check on the topic itself before we flip its status. A topic that is
// not the caller's resolves to the SAME 404 as a missing one.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> },
) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const { topicId } = await params;
  let body: { approvedPaperIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const approved = new Set(Array.isArray(body.approvedPaperIds) ? body.approvedPaperIds : []);

  // 404, not 403: a topic that is someone else's is indistinguishable from one
  // that was never there.
  const owns = await prisma.topic.findFirst({
    where: { id: topicId, ownerId },
    select: { id: true },
  });
  if (!owns) return notFoundForUser("Topik");

  const rows = await prisma.topicPaper.findMany({
    where: { topicId, topic: { ownerId } },
  });
  for (const tp of rows) {
    await prisma.topicPaper.update({
      where: { topicId_paperId: { topicId, paperId: tp.paperId } },
      data: { approved: approved.has(tp.paperId) },
    });
  }
  await prisma.topic.update({
    where: { id: topicId },
    data: { status: approved.size > 0 ? "papers_approved" : "papers_fetched" },
  });

  return NextResponse.json({ topicId, approvedCount: approved.size });
}
