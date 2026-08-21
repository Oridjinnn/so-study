import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { review, outcomeToGrade, isDue, type SchedulerState } from "@/src/lib/scheduler";
import type { AssessmentAttempt } from "@/app/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AttemptItem {
  questionType: "mcq" | "essay";
  itemRef: string;
  prompt: string;
  response?: string;
  isCorrect?: boolean;
  score?: number;
  confidence?: number;
}

interface PostBody {
  moduleId?: unknown;
  topicId?: unknown;
  items?: unknown;
}

function isItemArray(value: unknown): value is AttemptItem[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (it) =>
      it != null &&
      typeof it === "object" &&
      (it.questionType === "mcq" || it.questionType === "essay") &&
      typeof it.itemRef === "string" &&
      typeof it.prompt === "string",
  );
}

function serialize(attempt: {
  id: string;
  moduleId: string;
  topicId: string;
  questionType: string;
  itemRef: string;
  prompt: string;
  response: string | null;
  score: number | null;
  isCorrect: boolean | null;
  confidence: number | null;
  answeredAt: Date;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  stability: number;
  difficulty: number;
  scheduledNextAt: Date | null;
}): AssessmentAttempt {
  return {
    id: attempt.id,
    moduleId: attempt.moduleId,
    topicId: attempt.topicId,
    questionType: attempt.questionType === "essay" ? "essay" : "mcq",
    itemRef: attempt.itemRef,
    prompt: attempt.prompt,
    response: attempt.response,
    score: attempt.score,
    isCorrect: attempt.isCorrect,
    confidence: attempt.confidence,
    answeredAt: attempt.answeredAt.toISOString(),
    intervalDays: attempt.intervalDays,
    repetitions: attempt.repetitions,
    easeFactor: attempt.easeFactor,
    stability: attempt.stability,
    difficulty: attempt.difficulty,
    scheduledNextAt: attempt.scheduledNextAt ? attempt.scheduledNextAt.toISOString() : null,
  };
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const moduleId = typeof body.moduleId === "string" ? body.moduleId : "";
  const topicId = typeof body.topicId === "string" ? body.topicId : "";
  const items = body.items;

  if (!moduleId || !topicId || !isItemArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "Fields 'moduleId', 'topicId', and a non-empty 'items' array are required." },
      { status: 400 },
    );
  }

  const created = await Promise.all(
    items.map(async (it) => {
      const confidence =
        typeof it.confidence === "number" ? Math.round(it.confidence) : null;
      const isCorrect =
        typeof it.isCorrect === "boolean" ? it.isCorrect : null;

      // Carry forward this card's spaced-repetition state so the interval
      // expands across reviews instead of restarting every time.
      const prev = await prisma.assessmentAttempt.findFirst({
        where: { moduleId, topicId, questionType: it.questionType, itemRef: it.itemRef },
        orderBy: { answeredAt: "desc" },
        select: { intervalDays: true, repetitions: true, easeFactor: true, stability: true, difficulty: true },
      });
      const prevState: SchedulerState | null = prev
        ? { intervalDays: prev.intervalDays, repetitions: prev.repetitions, easeFactor: prev.easeFactor, stability: prev.stability, difficulty: prev.difficulty }
        : null;

      const grade = outcomeToGrade(isCorrect, confidence);
      const { state, nextReview } = review(prevState, grade);

      return prisma.assessmentAttempt.create({
        data: {
          moduleId,
          topicId,
          questionType: it.questionType,
          itemRef: it.itemRef,
          prompt: it.prompt,
          response: it.response ?? null,
          score: typeof it.score === "number" ? it.score : null,
          isCorrect,
          confidence,
          intervalDays: state.intervalDays,
          repetitions: state.repetitions,
          easeFactor: state.easeFactor,
          stability: state.stability,
          difficulty: state.difficulty,
          scheduledNextAt: nextReview,
        },
      });
    }),
  );

  return NextResponse.json({ ok: true, attempts: created.map(serialize) });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const due = searchParams.get("due") === "1";
  const moduleId = searchParams.get("moduleId");
  const topicId = searchParams.get("topicId");

  const where: {
    moduleId?: string;
    topicId?: string;
  } = {};
  if (moduleId) where.moduleId = moduleId;
  if (topicId) where.topicId = topicId;

  const rows = await prisma.assessmentAttempt.findMany({
    where,
    orderBy: [{ scheduledNextAt: { sort: "asc", nulls: "last" } }, { answeredAt: "desc" }],
  });

  const attempts = rows.map(serialize);
  const filtered = due ? attempts.filter((a) => isDue(a)) : attempts;

  return NextResponse.json({ attempts: filtered });
}
