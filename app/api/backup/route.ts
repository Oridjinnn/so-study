import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireUser } from "@/src/lib/tenancy";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ===========================================================================
// TENANCY NOTE — this file used to be the worst leak in the app.
//
// `GET /api/backup` dumped EVERY row of EVERY table: one student pressing
// "Ekspor data" downloaded the other student's courses, modules, practice
// history and Q&A transcripts as a single JSON file. It is now scoped to the
// caller, table by table, either by `ownerId` (Course/Topic/Module) or through
// the relation that reaches an owner (`module: { ownerId }`, `topic: { ownerId }`,
// `course: { ownerId }`).
//
// `POST /api/backup` upserted rows by their primary key, so a hand-edited (or
// simply foreign) backup file could overwrite rows belonging to the other
// account — the mirror-image bug, a write instead of a read. Every incoming row
// is now checked twice: the row it would REPLACE must already be the caller's,
// and every parent id it REFERENCES must be the caller's. Anything else is
// skipped and counted, never applied.
//
// `Paper` is the deliberate exception: it is global and deduplicated across
// users (schema: shared `Paper` + per-topic `TopicPaper`), so papers are neither
// filtered by owner nor rejected on import. The export still only includes the
// papers the caller's own topics/excerpts actually reference — a full paper table
// would disclose what the other student has been reading.
// ===========================================================================

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

// A loose delegate so we can upsert/verify any table in a loop without
// re-listing the (lengthy, per-model) Prisma input types. The row is already a
// complete model object as exported, so passing it straight through is safe at
// runtime.
type AnyDelegate = {
  findFirst(args: {
    where: Record<string, unknown>;
    select?: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;
  upsert(args: {
    where: { id: string } | { topicId_paperId: { topicId: string; paperId: string } };
    create: unknown;
    update: unknown;
  }): Promise<unknown>;
};

export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  // Course/Topic/Module carry the owner directly; everything below them is
  // reached through the relation that does. Read in that shape rather than
  // post-filtering in JS: a row that is not the caller's never leaves the
  // database, so there is no filtered-copy step that could be forgotten.
  const topics = await prisma.topic.findMany({ where: { ownerId } });
  const ownedTopicIds = topics.map((t) => t.id);

  const data: BackupData = {
    // GLOBAL, but not "all of it": only the shared papers that the caller's own
    // topics cite or their own modules quote. Anything else is a paper the other
    // student found, and their reading list is theirs.
    papers: await prisma.paper.findMany({
      where: {
        OR: [
          { topicPapers: { some: { topic: { ownerId } } } },
          { excerpts: { some: { module: { ownerId } } } },
        ],
      },
    }),
    courses: await prisma.course.findMany({ where: { ownerId } }),
    topics,
    modules: await prisma.module.findMany({ where: { ownerId } }),
    courseModules: await prisma.courseModule.findMany({ where: { course: { ownerId } } }),
    moduleChunks: await prisma.moduleChunk.findMany({ where: { module: { ownerId } } }),
    excerpts: await prisma.excerpt.findMany({ where: { module: { ownerId } } }),
    moduleVersions: await prisma.moduleVersion.findMany({ where: { module: { ownerId } } }),
    qaSessions: await prisma.qASession.findMany({ where: { topic: { ownerId } } }),
    assessmentAttempts: await prisma.assessmentAttempt.findMany({ where: { topic: { ownerId } } }),
    questionBankItems: await prisma.questionBankItem.findMany({ where: { topic: { ownerId } } }),
    // AIUsage is deliberately GLOBAL (one shared Gemini key/wallet) and has no
    // owner column, so "mine" is defined by the topic a call was made for.
    // Rows with no topic at all are unattributable shared spend — already
    // visible to both students through GET /api/usage — so they stay in, while a
    // row pointing at the other student's topic (which would disclose her topic
    // ids) does not.
    aiUsage: await prisma.aIUsage.findMany({
      where: { OR: [{ topicId: { in: ownedTopicIds } }, { topicId: null }] },
    }),
    rpsReconciles: await prisma.rPSReconcile.findMany({ where: { course: { ownerId } } }),
    topicPapers: await prisma.topicPaper.findMany({ where: { topic: { ownerId } } }),
  };

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    version: 1 as const,
    data,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

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
  const { counts, skipped } = await importData(ownerId, data);

  return NextResponse.json({ ok: true, counts, skipped });
}

/** The three models that carry `ownerId` themselves; every other row is
 *  authorized by walking to one of these. */
type OwnedKind = "course" | "topic" | "module";

interface ImportRule {
  /** Table delegate on the transaction client. */
  delegate: AnyDelegate;
  /** Overwrite the row's owner with the caller's id (Course/Topic/Module). */
  stampOwner?: boolean;
  /** After writing, remember the id as owned (it may parent later rows). */
  registers?: OwnedKind;
  /** Required foreign keys in the incoming row that must be the caller's. */
  refs?: [field: string, kind: OwnedKind][];
  /** Foreign keys that may be absent, but must be the caller's when present. */
  optionalRefs?: [field: string, kind: OwnedKind][];
  /**
   * `where` fragment proving an EXISTING row with this id already belongs to the
   * caller. Absent for the deliberately global tables (Paper, AIUsage).
   */
  own?: Record<string, unknown>;
}

/**
 * Apply a backup file as the caller's own data.
 *
 * Two invariants, both enforced per row inside one transaction:
 *   1. NO CROSS-TENANT OVERWRITE — if the id already exists and is not the
 *      caller's, the row is skipped. Otherwise a copied-and-edited file could
 *      rewrite the other student's module content by id.
 *   2. NO CROSS-TENANT ADOPTION — every parent id the row references
 *      (courseId/topicId/moduleId) must resolve to a row the caller owns, so an
 *      import cannot staple attempts, chunks or questions onto her topics.
 * Ownership is also STAMPED, not trusted: an `ownerId` field inside the file is
 * ignored and replaced with the caller's, so importing a file can only ever
 * produce rows owned by the person importing it.
 *
 * Rows that fail either check are counted in `skipped` rather than aborting the
 * whole import: a backup is usually mostly valid, and failing the lot would
 * leave the student with no way to restore the good part.
 */
async function importData(
  ownerId: string,
  data: BackupData,
): Promise<{ counts: Record<string, number>; skipped: Record<string, number> }> {
  const counts: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  await prisma.$transaction(async (tx) => {
    const ownerDelegate: Record<OwnedKind, AnyDelegate> = {
      course: tx.course as unknown as AnyDelegate,
      topic: tx.topic as unknown as AnyDelegate,
      module: tx.module as unknown as AnyDelegate,
    };
    // Memoized "is this parent mine?" — a backup references the same handful of
    // courses/topics/modules thousands of times (one per chunk, per attempt), so
    // without the cache the import would re-ask the same question all day.
    const ownedCache: Record<OwnedKind, Map<string, boolean>> = {
      course: new Map(),
      topic: new Map(),
      module: new Map(),
    };

    async function isOwned(kind: OwnedKind, id: unknown): Promise<boolean> {
      if (typeof id !== "string" || id === "") return false;
      const cached = ownedCache[kind].get(id);
      if (cached !== undefined) return cached;
      const row = await ownerDelegate[kind].findFirst({
        where: { id, ownerId },
        select: { id: true },
      });
      const owned = row != null;
      ownedCache[kind].set(id, owned);
      return owned;
    }

    const rules: Record<IdTable, ImportRule> = {
      // Global + deduplicated by design: a paper is the same paper for everyone.
      papers: { delegate: tx.paper as unknown as AnyDelegate },
      courses: {
        delegate: tx.course as unknown as AnyDelegate,
        stampOwner: true,
        registers: "course",
        own: { ownerId },
      },
      topics: {
        delegate: tx.topic as unknown as AnyDelegate,
        stampOwner: true,
        registers: "topic",
        refs: [["courseId", "course"]],
        own: { ownerId },
      },
      modules: {
        delegate: tx.module as unknown as AnyDelegate,
        stampOwner: true,
        registers: "module",
        refs: [["topicId", "topic"]],
        own: { ownerId },
      },
      courseModules: {
        delegate: tx.courseModule as unknown as AnyDelegate,
        refs: [
          ["courseId", "course"],
          ["moduleId", "module"],
        ],
        own: { course: { ownerId } },
      },
      moduleChunks: {
        delegate: tx.moduleChunk as unknown as AnyDelegate,
        refs: [["moduleId", "module"]],
        own: { module: { ownerId } },
      },
      excerpts: {
        delegate: tx.excerpt as unknown as AnyDelegate,
        refs: [["moduleId", "module"]],
        own: { module: { ownerId } },
      },
      moduleVersions: {
        delegate: tx.moduleVersion as unknown as AnyDelegate,
        refs: [["moduleId", "module"]],
        own: { module: { ownerId } },
      },
      qaSessions: {
        delegate: tx.qASession as unknown as AnyDelegate,
        refs: [["topicId", "topic"]],
        own: { topic: { ownerId } },
      },
      assessmentAttempts: {
        delegate: tx.assessmentAttempt as unknown as AnyDelegate,
        refs: [
          ["topicId", "topic"],
          ["moduleId", "module"],
        ],
        own: { topic: { ownerId } },
      },
      questionBankItems: {
        delegate: tx.questionBankItem as unknown as AnyDelegate,
        refs: [["topicId", "topic"]],
        own: { topic: { ownerId } },
      },
      // Global shared-wallet ledger: no owner to check, but its optional topicId
      // must not be pointed at someone else's topic.
      aiUsage: {
        delegate: tx.aIUsage as unknown as AnyDelegate,
        optionalRefs: [["topicId", "topic"]],
      },
      rpsReconciles: {
        delegate: tx.rPSReconcile as unknown as AnyDelegate,
        refs: [["courseId", "course"]],
        own: { course: { ownerId } },
      },
    };

    /** True when the row may be written: refs are the caller's AND it would not
     *  replace someone else's row. */
    async function mayWrite(
      rule: ImportRule,
      row: Record<string, unknown>,
      id: string,
    ): Promise<boolean> {
      for (const [field, kind] of rule.refs ?? []) {
        if (!(await isOwned(kind, row[field]))) return false;
      }
      for (const [field, kind] of rule.optionalRefs ?? []) {
        const value = row[field];
        if (value == null) continue;
        if (!(await isOwned(kind, value))) return false;
      }
      if (!rule.own) return true;

      // Mine already? Then the upsert is an ordinary restore.
      const mine = await rule.delegate.findFirst({
        where: { id, ...rule.own },
        select: { id: true },
      });
      if (mine) return true;
      // Not mine — but is it anybody's? An id that exists under the OTHER
      // account must not be upserted (that is the overwrite we are preventing);
      // an id that exists nowhere is simply a new row. This is the one
      // deliberately unscoped read in the file: it returns nothing but the id,
      // and only ever to refuse.
      const foreign = await rule.delegate.findFirst({ where: { id }, select: { id: true } });
      return foreign == null;
    }

    for (const table of ID_TABLES) {
      const rows = (data[table] ?? []) as Array<Record<string, unknown>>;
      const rule = rules[table];
      let written = 0;
      let refused = 0;
      for (const row of rows) {
        const id = String(row.id);
        if (!(await mayWrite(rule, row, id))) {
          refused += 1;
          continue;
        }
        // Ownership is stamped from the SESSION, never read from the file.
        const payload = rule.stampOwner ? { ...row, ownerId } : row;
        await rule.delegate.upsert({
          where: { id },
          create: payload,
          update: payload,
        });
        if (rule.registers) ownedCache[rule.registers].set(id, true);
        written += 1;
      }
      counts[table] = written;
      skipped[table] = refused;
    }

    // TopicPaper has no id column: it is keyed by (topicId, paperId), so the
    // topic side is both the parent check and the ownership check — a pair whose
    // topic is not the caller's cannot be reached at all.
    const topicPapers = (data.topicPapers ?? []) as Array<Record<string, unknown>>;
    let writtenPairs = 0;
    let refusedPairs = 0;
    for (const row of topicPapers) {
      if (!(await isOwned("topic", row.topicId))) {
        refusedPairs += 1;
        continue;
      }
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
      writtenPairs += 1;
    }
    counts.topicPapers = writtenPairs;
    skipped.topicPapers = refusedPairs;
  });

  return { counts, skipped };
}
