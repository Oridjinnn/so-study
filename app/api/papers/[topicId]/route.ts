import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Candidate papers for a topic, with their human approval state. Drives the
// review/approval bottom sheet before synthesis.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> },
) {
  const { topicId } = await params;
  const rows = await prisma.topicPaper.findMany({
    where: { topicId },
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
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ topicId: string }> },
) {
  const { topicId } = await params;
  let body: { approvedPaperIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const approved = new Set(Array.isArray(body.approvedPaperIds) ? body.approvedPaperIds : []);

  const rows = await prisma.topicPaper.findMany({ where: { topicId } });
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
