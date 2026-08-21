import { NextRequest, NextResponse } from "next/server";
import { retrieveSources, SourcePaper } from "@/src/lib/sources";
import { expandKeywords, scoringTerms } from "@/src/lib/keywords";
import { prisma } from "@/src/lib/prisma";
import { ensureTopic, resolveCourseMajor } from "@/src/lib/topics";
import {
  GUARD_STATUS,
  LIMITS,
  firstGuardError,
  guardBodyBytes,
  guardCount,
  guardLength,
} from "@/src/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stage 1 (whitepaper §4): fetch a candidate paper shortlist from OpenAlex
// (heuristic + cached, no LLM), persist them as unapproved TopicPapers, and
// return them for the human review/approval gate before synthesis.
export async function POST(req: NextRequest) {
  const bodyTooBig = guardBodyBytes(req.headers.get("content-length"));
  if (bodyTooBig) {
    return NextResponse.json({ error: bodyTooBig.error }, { status: GUARD_STATUS });
  }

  let body: { topicId?: string; title?: string; keywords?: string[]; weekNumber?: number; dueBeforeLecture?: string; courseId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "Field 'title' is required." }, { status: 400 });
  }
  const keywords = Array.isArray(body.keywords) ? body.keywords : [];

  // Retrieval does no LLM call, but it is a free-text endpoint that persists
  // rows and builds a cache filename from the query — bound it like the rest.
  const guardFailure = firstGuardError(
    guardLength("title", "Judul topik", title, LIMITS.title),
    guardCount("keywords", "Kata kunci", keywords.length, LIMITS.keywordCount),
    guardLength("keywords", "Total kata kunci", keywords.join(" "), LIMITS.keywordChars),
  );
  if (guardFailure) {
    return NextResponse.json({ error: guardFailure.error }, { status: GUARD_STATUS });
  }

  // The course's jurusan biases WHICH papers come back (see openalex.ts), so it
  // has to be resolved before the query — read-only, so a later retrieval
  // failure still leaves no Topic behind.
  const major = await resolveCourseMajor({ courseId: body.courseId, topicId: body.topicId });

  // Broaden the net: expand the title + user keywords into more search terms
  // (including title bigrams) so providers return a wider, more relevant pool.
  // The concise set is kept for ranking so the overlap score stays meaningful.
  const searchKeywords = expandKeywords(title, keywords);
  const rankingTerms = scoringTerms(title, keywords);

  let raw: SourcePaper[];
  try {
    raw = await retrieveSources(title, searchKeywords, {
      cache: true,
      major,
      scoringTerms: rankingTerms,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Retrieval failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }
  if (raw.length === 0) {
    return NextResponse.json(
      { error: "OpenAlex tidak mengembalikan paper untuk topik ini." },
      { status: 404 },
    );
  }

  // `courseId` anchors the Topic to the course the student picked (the same
  // argument /api/synthesize already forwards). Without it every retrieved topic
  // is filed under the shared default course and never shows up in the course
  // the student created it in.
  const topic = await ensureTopic(title, body.topicId, body.courseId);

  const candidates = [];
  for (const p of raw) {
    if (!p.sourceUrl) continue;
    const paper = await prisma.paper.upsert({
      where: { sourceUrl: p.sourceUrl },
      update: {
        title: p.title,
        authors: p.authors,
        year: p.year,
        abstract: p.abstract,
        citationCount: p.citationCount,
        relevanceScore: p.relevanceScore,
        fullTextAvailable: p.fullTextAvailable,
        doi: p.doi ?? null,
        venue: p.venue ?? null,
        volume: p.volume ?? null,
        issue: p.issue ?? null,
        pages: p.pages ?? null,
        publisher: p.publisher ?? null,
        type: p.type ?? null,
        providers: p.provider,
      },
      create: {
        title: p.title,
        authors: p.authors,
        year: p.year,
        abstract: p.abstract,
        sourceUrl: p.sourceUrl,
        citationCount: p.citationCount,
        relevanceScore: p.relevanceScore,
        fullTextAvailable: p.fullTextAvailable,
        doi: p.doi ?? null,
        venue: p.venue ?? null,
        volume: p.volume ?? null,
        issue: p.issue ?? null,
        pages: p.pages ?? null,
        publisher: p.publisher ?? null,
        type: p.type ?? null,
        providers: p.provider,
      },
    });
    const tp = await prisma.topicPaper.upsert({
      where: { topicId_paperId: { topicId: topic.id, paperId: paper.id } },
      update: {},
      create: { topicId: topic.id, paperId: paper.id, approved: false },
    });
    candidates.push({
      id: paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      citationCount: paper.citationCount,
      relevanceScore: paper.relevanceScore,
        sourceUrl: paper.sourceUrl,
        fullTextAvailable: paper.fullTextAvailable,
        language: p.language ?? null,
        venue: paper.venue ?? null,
        type: paper.type ?? null,
        approved: tp.approved,
      });
  }

  await prisma.topic.update({
    where: { id: topic.id },
    data: {
      status: "papers_fetched",
      ...(body.weekNumber != null ? { weekNumber: Number(body.weekNumber) } : {}),
      ...(body.dueBeforeLecture ? { dueBeforeLecture: new Date(body.dueBeforeLecture) } : {}),
    },
  });

  candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return NextResponse.json({ topicId: topic.id, papers: candidates });
}
