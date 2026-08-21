import { NextRequest, NextResponse } from "next/server";
import { generate } from "@/src/lib/gemini";
import { logAIUsage } from "@/src/lib/aiusage";
import { prisma } from "@/src/lib/prisma";
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

  // Resolve the real course name for the prompt (falls back to generic if the
  // topic/course cannot be found).
  let courseName = "mata kuliah ini";
  if (body.topicId) {
    const topic = await prisma.topic.findUnique({
      where: { id: body.topicId },
      include: { course: true },
    });
    if (topic?.course?.name) courseName = topic.course.name;
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
