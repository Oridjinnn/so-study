import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tables whose rows carry a single `id` primary key — these upsert by `id`.
const ID_TABLES = [
  "papers",
  "courses",
  "topics",
  "modules",
  "courseModules",
  "moduleChunks",
  "excerpts",
  "moduleVersions",
  "qaSessions",
  "assessmentAttempts",
  "questionBankItems",
  "aiUsage",
  "rpsReconciles",
] as const;
type IdTable = (typeof ID_TABLES)[number];

// The export/import contract. A row is any object that at least carries the
// key Prisma needs to locate it (id for most tables, the topicId/paperId pair
// for the TopicPaper join, which has no id column).
const idRow = z.object({ id: z.string().min(1) }).catchall(z.unknown());
const topicPaperRow = z
  .object({ topicId: z.string().min(1), paperId: z.string().min(1) })
  .catchall(z.unknown());

const dataSchema = z.object({
  papers: z.array(idRow).optional(),
  courses: z.array(idRow).optional(),
  topics: z.array(idRow).optional(),
  modules: z.array(idRow).optional(),
  courseModules: z.array(idRow).optional(),
  moduleChunks: z.array(idRow).optional(),
  excerpts: z.array(idRow).optional(),
  moduleVersions: z.array(idRow).optional(),
  qaSessions: z.array(idRow).optional(),
  assessmentAttempts: z.array(idRow).optional(),
  questionBankItems: z.array(idRow).optional(),
  aiUsage: z.array(idRow).optional(),
  rpsReconciles: z.array(idRow).optional(),
  topicPapers: z.array(topicPaperRow).optional(),
});

type BackupData = z.infer<typeof dataSchema>;

// A loose delegate so we can upsert any table in a loop without re-listing the
// (lengthy, per-model) Prisma input types. The row is already a complete model
// object as exported, so passing it straight through is safe at runtime.
type AnyDelegate = {
  upsert(args: {
    where: { id: string } | { topicId_paperId: { topicId: string; paperId: string } };
    create: unknown;
    update: unknown;
  }): Promise<unknown>;
};

export async function GET() {
  const data: BackupData = {
    papers: await prisma.paper.findMany(),
    courses: await prisma.course.findMany(),
    topics: await prisma.topic.findMany(),
    modules: await prisma.module.findMany(),
    courseModules: await prisma.courseModule.findMany(),
    moduleChunks: await prisma.moduleChunk.findMany(),
    excerpts: await prisma.excerpt.findMany(),
    moduleVersions: await prisma.moduleVersion.findMany(),
    qaSessions: await prisma.qASession.findMany(),
    assessmentAttempts: await prisma.assessmentAttempt.findMany(),
    questionBankItems: await prisma.questionBankItem.findMany(),
    aiUsage: await prisma.aIUsage.findMany(),
    rpsReconciles: await prisma.rPSReconcile.findMany(),
    topicPapers: await prisma.topicPaper.findMany(),
  };

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    version: 1 as const,
    data,
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON yang valid." }, { status: 400 });
  }

  const parsed = z
    .object({ confirm: z.unknown(), data: dataSchema })
    .passthrough()
    .safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Format cadangan tidak dikenali." },
      { status: 400 },
    );
  }

  if (parsed.data.confirm !== "overwrite") {
    return NextResponse.json(
      { error: "Impor memerlukan konfirmasi `confirm: \"overwrite\"`." },
      { status: 400 },
    );
  }

  const data = parsed.data.data;
  const counts = await importData(data);

  return NextResponse.json({ ok: true, counts });
}

async function importData(data: BackupData): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  await prisma.$transaction(async (tx) => {
    const delegates: Record<IdTable, AnyDelegate> = {
      papers: tx.paper as unknown as AnyDelegate,
      courses: tx.course as unknown as AnyDelegate,
      topics: tx.topic as unknown as AnyDelegate,
      modules: tx.module as unknown as AnyDelegate,
      courseModules: tx.courseModule as unknown as AnyDelegate,
      moduleChunks: tx.moduleChunk as unknown as AnyDelegate,
      excerpts: tx.excerpt as unknown as AnyDelegate,
      moduleVersions: tx.moduleVersion as unknown as AnyDelegate,
      qaSessions: tx.qASession as unknown as AnyDelegate,
      assessmentAttempts: tx.assessmentAttempt as unknown as AnyDelegate,
      questionBankItems: tx.questionBankItem as unknown as AnyDelegate,
      aiUsage: tx.aIUsage as unknown as AnyDelegate,
      rpsReconciles: tx.rPSReconcile as unknown as AnyDelegate,
    };

    for (const table of ID_TABLES) {
      const rows = (data[table] ?? []) as Array<Record<string, unknown>>;
      const delegate = delegates[table];
      for (const row of rows) {
        await delegate.upsert({
          where: { id: String(row.id) },
          create: row,
          update: row,
        });
      }
      counts[table] = rows.length;
    }

    const topicPapers = (data.topicPapers ?? []) as Array<Record<string, unknown>>;
    for (const row of topicPapers) {
      await tx.topicPaper.upsert({
        where: {
          topicId_paperId: {
            topicId: String(row.topicId),
            paperId: String(row.paperId),
          },
        },
        create: row as unknown as Prisma.TopicPaperCreateInput,
        update: row as unknown as Prisma.TopicPaperUpdateInput,
      });
    }
    counts.topicPapers = topicPapers.length;
  });

  return counts;
}
