// One-shot data migration: the old local SQLite file -> the hosted Postgres.
//
//   node scripts/import-sqlite.mjs [path/to/dev.db] --owner <userName>
//
// WHY THIS EXISTS: the app used to store everything in `prisma/dev.db`, which is
// why it could never be deployed. Switching the datasource to Postgres does not
// move the data, and the existing rows are real study work (modules, approved
// papers, excerpts, chunk embeddings) that took paid Gemini calls to produce.
// Re-synthesizing them would cost money and lose the verification reports.
//
// Every imported row is assigned to ONE owner (`--owner`, a seeded User.name),
// because the old schema had no concept of ownership — all of it belonged to the
// single student the app was built for.
//
// Reads SQLite through node:sqlite (built into Node 22, so no dependency) and
// writes through Prisma, in foreign-key order, inside one transaction: a partial
// import that leaves modules without their papers is worse than no import.
// Re-running is safe-ish by design — it SKIPS ids that already exist rather than
// updating them, so an interrupted run can be repeated.

import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const ownerFlag = args.indexOf("--owner");
const ownerName = ownerFlag >= 0 ? args[ownerFlag + 1] : process.env.IMPORT_OWNER;
const dbPath = args.find((a) => !a.startsWith("--") && a !== ownerName) ?? "prisma/dev.db";

if (!ownerName) {
  console.error(
    "usage: node scripts/import-sqlite.mjs [path/to/dev.db] --owner <seeded user name>",
  );
  process.exit(1);
}

const sqlite = new DatabaseSync(dbPath, { readOnly: true });
const prisma = new PrismaClient();

/** SQLite stores DateTime as epoch-millis (Prisma's sqlite mapping) or ISO text. */
function toDate(value) {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "bigint") return new Date(Number(value));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** SQLite has no boolean: Prisma stores 0/1. */
const toBool = (v) => v === 1 || v === true;
const rows = (table) => sqlite.prepare(`SELECT * FROM "${table}"`).all();

try {
  const owner = await prisma.user.findUnique({ where: { name: ownerName } });
  if (!owner) {
    throw new Error(
      `no seeded user named "${ownerName}". Run scripts/seed-users.mjs first.`,
    );
  }

  const counts = {};
  await prisma.$transaction(
    async (tx) => {
      // Papers are shared/global (deduplicated across topics and users) — they
      // carry no private data, so they are imported without an owner.
      for (const p of rows("Paper")) {
        await tx.paper.upsert({
          where: { id: p.id },
          update: {},
          create: {
            id: p.id,
            title: p.title,
            authors: p.authors,
            year: p.year,
            abstract: p.abstract,
            sourceUrl: p.sourceUrl,
            citationCount: p.citationCount,
            relevanceScore: p.relevanceScore,
            fullTextAvailable: toBool(p.fullTextAvailable),
            doi: p.doi,
            venue: p.venue,
            volume: p.volume,
            issue: p.issue,
            pages: p.pages,
            publisher: p.publisher,
            type: p.type,
            providers: p.providers,
          },
        });
      }
      counts.Paper = rows("Paper").length;

      for (const c of rows("Course")) {
        await tx.course.upsert({
          where: { id: c.id },
          update: {},
          create: { id: c.id, ownerId: owner.id, name: c.name, major: c.major },
        });
      }
      counts.Course = rows("Course").length;

      for (const t of rows("Topic")) {
        await tx.topic.upsert({
          where: { id: t.id },
          update: {},
          create: {
            id: t.id,
            ownerId: owner.id,
            courseId: t.courseId,
            title: t.title,
            weekNumber: t.weekNumber,
            dueBeforeLecture: toDate(t.dueBeforeLecture),
            orderSource: t.orderSource ?? "custom",
            status: t.status,
          },
        });
      }
      counts.Topic = rows("Topic").length;

      for (const tp of rows("TopicPaper")) {
        await tx.topicPaper.upsert({
          where: { topicId_paperId: { topicId: tp.topicId, paperId: tp.paperId } },
          update: {},
          create: {
            topicId: tp.topicId,
            paperId: tp.paperId,
            approved: toBool(tp.approved),
            addedAt: toDate(tp.addedAt) ?? new Date(),
          },
        });
      }
      counts.TopicPaper = rows("TopicPaper").length;

      for (const m of rows("Module")) {
        await tx.module.upsert({
          where: { id: m.id },
          update: {},
          create: {
            id: m.id,
            ownerId: owner.id,
            topicId: m.topicId,
            contentMarkdown: m.contentMarkdown,
            generatedAt: toDate(m.generatedAt) ?? new Date(),
            sourcePaperIds: m.sourcePaperIds,
            wordCount: m.wordCount,
            pageCount: m.pageCount,
            verifyReport: m.verifyReport,
            criticReport: m.criticReport,
            verifiedAt: toDate(m.verifiedAt),
            repairAttempts: m.repairAttempts ?? 0,
            essayPrompt: m.essayPrompt,
            essayRubric: m.essayRubric,
          },
        });
      }
      counts.Module = rows("Module").length;

      for (const cm of rows("CourseModule")) {
        await tx.courseModule.upsert({
          where: { courseId_moduleId: { courseId: cm.courseId, moduleId: cm.moduleId } },
          update: {},
          create: { id: cm.id, courseId: cm.courseId, moduleId: cm.moduleId },
        });
      }
      counts.CourseModule = rows("CourseModule").length;

      for (const ch of rows("ModuleChunk")) {
        await tx.moduleChunk.upsert({
          where: { id: ch.id },
          update: {},
          create: {
            id: ch.id,
            moduleId: ch.moduleId,
            chunkIndex: ch.chunkIndex,
            text: ch.text,
            embedding: ch.embedding,
          },
        });
      }
      counts.ModuleChunk = rows("ModuleChunk").length;

      for (const e of rows("Excerpt")) {
        await tx.excerpt.upsert({
          where: { id: e.id },
          update: {},
          create: {
            id: e.id,
            moduleId: e.moduleId,
            paperId: e.paperId,
            claim: e.claim,
            quote: e.quote,
            location: e.location,
          },
        });
      }
      counts.Excerpt = rows("Excerpt").length;

      for (const v of rows("ModuleVersion")) {
        await tx.moduleVersion.upsert({
          where: { id: v.id },
          update: {},
          create: {
            id: v.id,
            moduleId: v.moduleId,
            version: v.version,
            contentMarkdown: v.contentMarkdown,
            generatedAt: toDate(v.generatedAt) ?? new Date(),
            changeNote: v.changeNote,
          },
        });
      }
      counts.ModuleVersion = rows("ModuleVersion").length;

      for (const q of rows("QASession")) {
        await tx.qASession.upsert({
          where: { id: q.id },
          update: {},
          create: { id: q.id, topicId: q.topicId, messages: q.messages },
        });
      }
      counts.QASession = rows("QASession").length;

      for (const a of rows("AssessmentAttempt")) {
        await tx.assessmentAttempt.upsert({
          where: { id: a.id },
          update: {},
          create: {
            id: a.id,
            moduleId: a.moduleId,
            topicId: a.topicId,
            questionType: a.questionType,
            itemRef: a.itemRef,
            prompt: a.prompt,
            response: a.response,
            score: a.score,
            isCorrect: a.isCorrect == null ? null : toBool(a.isCorrect),
            confidence: a.confidence,
            answeredAt: toDate(a.answeredAt) ?? new Date(),
            intervalDays: a.intervalDays ?? 0,
            repetitions: a.repetitions ?? 0,
            easeFactor: a.easeFactor ?? 2.5,
            stability: a.stability ?? 1,
            difficulty: a.difficulty ?? 5,
            scheduledNextAt: toDate(a.scheduledNextAt),
          },
        });
      }
      counts.AssessmentAttempt = rows("AssessmentAttempt").length;

      for (const q of rows("QuestionBankItem")) {
        await tx.questionBankItem.upsert({
          where: { id: q.id },
          update: {},
          create: {
            id: q.id,
            topicId: q.topicId,
            moduleId: q.moduleId,
            stem: q.stem,
            options: q.options,
            answer: q.answer,
            explanation: q.explanation,
            author: q.author,
            createdAt: toDate(q.createdAt) ?? new Date(),
            updatedAt: toDate(q.updatedAt) ?? new Date(),
          },
        });
      }
      counts.QuestionBankItem = rows("QuestionBankItem").length;

      for (const r of rows("RPSReconcile")) {
        await tx.rPSReconcile.upsert({
          where: { courseId: r.courseId },
          update: {},
          create: {
            id: r.id,
            courseId: r.courseId,
            officialOrder: r.officialOrder,
            customOrder: r.customOrder,
            reconciledAt: toDate(r.reconciledAt) ?? new Date(),
            updatedAt: toDate(r.updatedAt) ?? new Date(),
          },
        });
      }
      counts.RPSReconcile = rows("RPSReconcile").length;

      // Cost history is kept: it is the record of what the Gemini key has already
      // been billed for, and the new budget cap reads exactly this table.
      for (const u of rows("AIUsage")) {
        await tx.aIUsage.upsert({
          where: { id: u.id },
          update: {},
          create: {
            id: u.id,
            topicId: u.topicId,
            kind: u.kind,
            tokensIn: u.tokensIn,
            tokensOut: u.tokensOut,
            estimatedCost: u.estimatedCost,
            createdAt: toDate(u.createdAt) ?? new Date(),
          },
        });
      }
      counts.AIUsage = rows("AIUsage").length;

      // Settings/PushSubscription are NOT imported: the old Settings row was a
      // "singleton" whose primary key no longer exists (it is now keyed by user),
      // and push subscriptions are per-device credentials that must be re-granted
      // from the installed app anyway.
    },
    // The default 5s interactive-transaction budget is not enough for a few
    // hundred round-trips against a remote Postgres.
    { timeout: 120_000, maxWait: 20_000 },
  );

  console.log(`imported into owner "${owner.name}" (${owner.id}):`);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(6)}  ${table}`);
} finally {
  await prisma.$disconnect();
  sqlite.close();
}
