import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import type { QuestionBankItem } from "@/app/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawQuestionBankItem = {
  id: string;
  topicId: string;
  moduleId: string | null;
  stem: string;
  options: string;
  answer: string;
  explanation: string | null;
  author: string;
  createdAt: Date;
  updatedAt: Date;
};

function serialize(item: RawQuestionBankItem): QuestionBankItem {
  let parsedOptions: string[] = [];
  try {
    const raw = JSON.parse(item.options);
    if (Array.isArray(raw)) parsedOptions = raw.filter((o): o is string => typeof o === "string");
  } catch {
    parsedOptions = [];
  }
  return {
    id: item.id,
    topicId: item.topicId,
    moduleId: item.moduleId,
    stem: item.stem,
    options: parsedOptions,
    answer: item.answer,
    explanation: item.explanation,
    author: item.author === "ai" ? "ai" : "student",
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

async function findById(id: string) {
  return prisma.questionBankItem.findUnique({ where: { id } });
}

export async function GET(req: NextRequest) {
  const topicId = req.nextUrl.searchParams.get("topicId");
  const courseId = req.nextUrl.searchParams.get("courseId");

  let items: RawQuestionBankItem[];
  if (courseId) {
    items = await prisma.questionBankItem.findMany({
      where: { topic: { courseId } },
      orderBy: { createdAt: "asc" },
    });
  } else if (topicId) {
    items = await prisma.questionBankItem.findMany({
      where: { topicId },
      orderBy: { createdAt: "asc" },
    });
  } else {
    return NextResponse.json(
      { error: "Provide query param 'topicId' or 'courseId'." },
      { status: 400 },
    );
  }

  return NextResponse.json({ items: items.map(serialize) });
}

// POST body contract:
//   { topicId, moduleId?, stem, options: string[] (>=2), answer (one of options),
//     explanation?, author?: "ai" | "student" }
// `author` defaults to "student" (the generation-effect path). The Latih tab
// passes "ai" so generated MCQs persist into the same bank and become
// practisable/exportable instead of vanishing with the panel — AI items stay
// read-only (PATCH/DELETE below reject anything not authored by the student).
export async function POST(req: NextRequest) {
  let body: {
    topicId?: string;
    moduleId?: string;
    stem?: string;
    options?: unknown;
    answer?: string;
    explanation?: string;
    author?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const topicId = body.topicId?.trim();
  const stem = body.stem?.trim();
  if (!topicId) {
    return NextResponse.json({ error: "Field 'topicId' is required." }, { status: 400 });
  }
  if (!stem) {
    return NextResponse.json({ error: "Field 'stem' is required." }, { status: 400 });
  }

  const options = Array.isArray(body.options)
    ? (body.options.filter((o): o is string => typeof o === "string").map((o) => o.trim()) as string[])
    : [];
  const answer = body.answer?.trim();
  const explanation = body.explanation?.trim() || null;

  if (options.length < 2) {
    return NextResponse.json(
      { error: "Minimal 2 opsi (options) diperlukan." },
      { status: 400 },
    );
  }
  if (!answer || !options.includes(answer)) {
    return NextResponse.json(
      { error: "Jawaban (answer) harus salah satu dari opsi." },
      { status: 400 },
    );
  }

  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) {
    return NextResponse.json({ error: "Topic tidak ditemukan." }, { status: 404 });
  }

  const author = body.author?.trim() === "ai" ? "ai" : "student";

  // Regenerating MCQs for the same module must not grow the bank without bound
  // (rule I7): an AI item with an identical stem is returned as-is instead of
  // duplicated. Student-authored items are never deduplicated — near-identical
  // rephrasings are the point of the generation effect.
  if (author === "ai") {
    const duplicate = await prisma.questionBankItem.findFirst({
      where: { topicId, stem, author: "ai" },
    });
    if (duplicate) return NextResponse.json(serialize(duplicate));
  }

  const created = await prisma.questionBankItem.create({
    data: {
      topicId,
      moduleId: body.moduleId?.trim() || null,
      stem,
      options: JSON.stringify(options),
      answer,
      explanation,
      author,
    },
  });

  return NextResponse.json(serialize(created), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Query param 'id' is required." }, { status: 400 });
  }

  let body: {
    stem?: string;
    options?: unknown;
    answer?: string;
    explanation?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const existing = await findById(id);
  if (!existing) {
    return NextResponse.json({ error: "Item tidak ditemukan." }, { status: 404 });
  }
  if (existing.author !== "student") {
    return NextResponse.json(
      { error: "Hanya item buatan sendiri (student) yang boleh diedit." },
      { status: 403 },
    );
  }

  const data: {
    stem?: string;
    options?: string;
    answer?: string;
    explanation?: string | null;
  } = {};

  if (body.stem != null) {
    const stem = body.stem.trim();
    if (!stem) return NextResponse.json({ error: "Field 'stem' kosong." }, { status: 400 });
    data.stem = stem;
  }

  if (body.options != null) {
    const options = Array.isArray(body.options)
      ? (body.options.filter((o): o is string => typeof o === "string").map((o) => o.trim()) as string[])
      : [];
    if (options.length < 2) {
      return NextResponse.json({ error: "Minimal 2 opsi (options)." }, { status: 400 });
    }
    data.options = JSON.stringify(options);
  }

  if (body.answer != null) {
    const answer = body.answer.trim();
    if (!answer) return NextResponse.json({ error: "Field 'answer' kosong." }, { status: 400 });
    const currentOptions: string[] = data.options
      ? JSON.parse(data.options)
      : JSON.parse(existing.options);
    if (!currentOptions.includes(answer)) {
      return NextResponse.json(
        { error: "Jawaban (answer) harus salah satu dari opsi." },
        { status: 400 },
      );
    }
    data.answer = answer;
  }

  if (body.explanation != null) {
    data.explanation = body.explanation.trim() || null;
  }

  const updated = await prisma.questionBankItem.update({ where: { id }, data });
  return NextResponse.json(serialize(updated));
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Query param 'id' is required." }, { status: 400 });
  }

  const existing = await findById(id);
  if (!existing) {
    return NextResponse.json({ error: "Item tidak ditemukan." }, { status: 404 });
  }
  if (existing.author !== "student") {
    return NextResponse.json(
      { error: "Hanya item buatan sendiri (student) yang boleh dihapus." },
      { status: 403 },
    );
  }

  await prisma.questionBankItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
