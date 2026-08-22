import { NextRequest, NextResponse } from "next/server";
import { generate } from "@/src/lib/gemini";
import { logAIUsage, assertBudget } from "@/src/lib/aiusage";
import { prisma } from "@/src/lib/prisma";
import { requireUser, notFoundForUser } from "@/src/lib/tenancy";
import {
  GUARD_STATUS,
  LIMITS,
  firstGuardError,
  guardBodyBytes,
  guardLength,
} from "@/src/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stage 4 (whitepaper §4): essay grading. Qualitative, rubric-grounded feedback
// (not just a number). MCQ grading stays deterministic client-side (no API).
function buildSystem(courseName: string) {
  return `Kamu adalah penguji esai untuk mata kuliah "${courseName}".
Beri umpan balik kualitatif yang terperinci dan terarah berdasarkan rubrik yang diberikan.
Sertakan rujukan ke bagian modul bila relevan (grounded).
Jangan sekadar memberi angka; jelaskan kekuatan dan kelemahan jawaban.`;
}

export async function POST(req: NextRequest) {
  // Auth FIRST: everything below either reads the database, probes the shared
  // budget, or spends a Gemini call on the shared key.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const bodyTooBig = guardBodyBytes(req.headers.get("content-length"));
  if (bodyTooBig) {
    return NextResponse.json({ error: bodyTooBig.error }, { status: GUARD_STATUS });
  }

  let body: { topicId?: string; questionText?: string; studentAnswer?: string; rubric?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const studentAnswer = body.studentAnswer?.trim();
  if (!studentAnswer) {
    return NextResponse.json({ error: "Field 'studentAnswer' is required." }, { status: 400 });
  }
  const rubric = body.rubric ?? "(tidak ada rubrik eksplisit)";

  // Resolve the real course name for the prompt — owner-scoped, because
  // `Course.name` is the other student's data: a `findUnique` by topic id would
  // have echoed her course name back in the graded feedback. CONTRACT CHANGE: a
  // topicId that is not the caller's (or does not exist) is now 404 instead of
  // quietly falling back to the generic course name; the topicId is also stamped
  // onto the AIUsage cost row, which must never point at another student's topic.
  let courseName = "mata kuliah ini";
  if (body.topicId) {
    const topic = await prisma.topic.findFirst({
      where: { id: body.topicId, ownerId },
      include: { course: true },
    });
    if (!topic) return notFoundForUser("Topik");
    if (topic.course?.name) courseName = topic.course.name;
  }

  // Bound the prompt before spending a Gemini call (I7/I8, mitigates R4).
  const violation = firstGuardError(
    guardLength("studentAnswer", "Jawaban esai", studentAnswer, LIMITS.studentAnswer),
    guardLength("questionText", "Pertanyaan esai", body.questionText, LIMITS.questionText),
    guardLength("rubric", "Rubrik", rubric, LIMITS.rubric),
  );
  if (violation) {
    return NextResponse.json({ error: violation.error }, { status: GUARD_STATUS });
  }

  // Cost gate (workstream C): never spend the grading call past the hard budget
  // cap. Runs after the cheap length guards, before the first (and only) paid
  // Gemini call below.
  try {
    await assertBudget();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 429 });
  }

  const prompt =
    `Soal:\n${body.questionText ?? "(tidak disebutkan)"}\n\n` +
    `Rubrik penilaian:\n${rubric}\n\n` +
    `Jawaban mahasiswa:\n${studentAnswer}\n\n` +
    `Berikan umpan balik esai yang terperinci dan grounded.`;

  try {
    const result = await generate({ system: buildSystem(courseName), prompt, maxOutputTokens: 2048 });
    await logAIUsage({ topicId: body.topicId, kind: "grade", usage: result.usage });
    return NextResponse.json({ feedback: result.text, usage: result.usage });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
