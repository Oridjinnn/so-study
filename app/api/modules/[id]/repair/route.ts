import { NextResponse } from "next/server";
import { generate } from "@/src/lib/gemini";
import { logAIUsage, assertBudget } from "@/src/lib/aiusage";
import { prisma } from "@/src/lib/prisma";
import { notFoundForUser, requireUser } from "@/src/lib/tenancy";
import { mcqHelpers } from "@/src/lib/mcq";
import { countWords, estimatePagesFromWords } from "@/src/lib/pages";
import { loadModuleForVerification } from "@/src/lib/moduleSources";
import { buildRepairSystem, MAX_REPAIR_ATTEMPTS } from "@/src/lib/repair";
import { verifyTier1 } from "@/src/lib/tier1";
import {
  parseCriticReport,
  pendingRepairItems,
  runTargetedRepair,
  verificationPayload,
} from "@/src/lib/verification";
import { GUARD_STATUS, guardBodyBytes } from "@/src/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/modules/[id]/repair — "Kembangkan lebih lagi?": a TARGETED fix of the
 * flagged claims, triggered by the student.
 *
 * This route never sends a generic "improve this module" prompt. It rebuilds the
 * flag list from Tier 1 (deterministic WARN/FAIL) and the cached Tier 2 verdicts,
 * and asks the model to revise exactly those claims against the exact source text
 * they cite (src/lib/repair.ts).
 *
 * Three refusals, all deliberate and all cheap (no Gemini call is made):
 *   1. No flags → 200 with `noop: true`. A clean module must not be "regenerated";
 *      the client shows that both tiers passed instead.
 *   2. Budget spent (`repairAttempts >= MAX_REPAIR_ATTEMPTS`) → 200 with
 *      `manualReviewNeeded: true`. Two targeted passes could not fix it, so the
 *      honest answer is "tinjau manual", not another loop.
 *   3. Missing module — or a module that is not the caller's → 404.
 *
 * On success the new content is persisted as a NEW ModuleVersion (never a blind
 * overwrite), with chunks/excerpts and both reports refreshed to describe the
 * text that now ships.
 *
 * Gate order matches verify/route.ts: session, then the free body-size guard,
 * then the AI budget, then ownership — every gate ahead of the cost it prevents,
 * and the session ahead of all of them so an anonymous caller cannot even learn
 * whether the budget is spent.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/modules/[id]/repair">) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const bodyTooBig = guardBodyBytes(req.headers.get("content-length"));
  if (bodyTooBig) {
    return NextResponse.json({ error: bodyTooBig.error }, { status: GUARD_STATUS });
  }

  // Cost gate (workstream C): runTargetedRepair() below spends Gemini calls, so
  // the gate must run before it — and before the module load (expensive DB work).
  try {
    await assertBudget();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 429 });
  }

  const { id } = await ctx.params;
  // Owner-scoped probe before the shared loader (which resolves by id alone and
  // lives in another workstream's file): a module id belonging to the other
  // student never reaches the loader, never reaches runTargetedRepair, and is
  // answered with the same 404 as an id that does not exist at all.
  const owned = await prisma.module.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!owned) return notFoundForUser("Modul");

  const mod = await loadModuleForVerification(id);
  if (!mod) return notFoundForUser("Modul");

  // Tier 1 is re-run rather than read from cache: it is free, and the cache may
  // predate an edit or a change in which papers are approved.
  const tier1 = verifyTier1(
    { contentMarkdown: mod.contentMarkdown, sourcePaperIds: mod.paperIds },
    mod.sources,
  );
  const critic = parseCriticReport(mod.criticReport);
  const items = pendingRepairItems(tier1, critic, mod.sources);

  if (items.length === 0) {
    return NextResponse.json({
      ok: true,
      noop: true,
      message:
        "Modul ini sudah lolos Tahap 1 (pemeriksaan deterministik) dan tidak punya klaim yang ditandai untuk ditinjau. Tidak ada yang perlu diperbaiki.",
      attemptsUsed: mod.repairAttempts,
      attemptsMax: MAX_REPAIR_ATTEMPTS,
      verification: verificationPayload({
        verifyReport: JSON.stringify(tier1),
        criticReport: mod.criticReport,
        verifiedAt: new Date(),
        repairAttempts: mod.repairAttempts,
      }),
    });
  }

  const remainingBudget = MAX_REPAIR_ATTEMPTS - mod.repairAttempts;
  if (remainingBudget <= 0) {
    return NextResponse.json({
      ok: true,
      manualReviewNeeded: true,
      message:
        `Sudah ${mod.repairAttempts} kali percobaan perbaikan terarah dan ${items.length} temuan masih ada: ` +
        "belum bisa diperbaiki otomatis, tinjau manual.",
      remainingFlags: items.length,
      attemptsUsed: mod.repairAttempts,
      attemptsMax: MAX_REPAIR_ATTEMPTS,
      verification: verificationPayload({
        verifyReport: JSON.stringify(tier1),
        criticReport: mod.criticReport,
        verifiedAt: new Date(),
        repairAttempts: mod.repairAttempts,
      }),
    });
  }

  const result = await runTargetedRepair({
    markdown: mod.contentMarkdown,
    sourcePaperIds: mod.paperIds,
    sources: mod.sources,
    tier1,
    critic,
    generate: (o) => generate(o),
    system: buildRepairSystem(mod.courseName, mod.major),
    maxPasses: remainingBudget,
    onUsage: (usage) => logAIUsage({ topicId: mod.topicId, kind: "repair", usage }),
  });

  const changed = result.markdown !== mod.contentMarkdown;
  if (changed) {
    const wordCount = countWords(result.markdown);
    const chunks = mcqHelpers.chunkText(result.markdown, 800);
    const claims = mod.paperIds.length ? mcqHelpers.extractClaims(result.markdown) : [];
    const versionNo =
      (await prisma.moduleVersion.count({
        // ModuleVersion carries no owner: it is scoped through its Module, the
        // only path by which it is reachable. Same for the chunk/excerpt deletes
        // below — a stray `moduleId` alone would be a cross-tenant delete.
        where: { moduleId: mod.id, module: { ownerId } },
      })) + 1;

    const excerptData = claims
      .filter((c) => c.paperIndex != null && mod.paperIds[c.paperIndex - 1])
      .map((c) => ({
        paperId: mod.paperIds[c.paperIndex! - 1],
        claim: c.text,
        quote: c.text,
        location: "repair",
      }));

    // One transaction: chunks/excerpts must never describe a different revision
    // of the text than `contentMarkdown` does. Every statement in it is
    // owner-scoped, so the transaction as a whole cannot touch another student's
    // module even if `mod.id` were somehow wrong.
    await prisma.$transaction([
      prisma.moduleChunk.deleteMany({ where: { moduleId: mod.id, module: { ownerId } } }),
      prisma.excerpt.deleteMany({ where: { moduleId: mod.id, module: { ownerId } } }),
      prisma.module.update({
        where: { id: mod.id, ownerId },
        data: {
          contentMarkdown: result.markdown,
          wordCount,
          pageCount: estimatePagesFromWords(wordCount),
          verifyReport: JSON.stringify(result.tier1),
          criticReport: result.critic ? JSON.stringify(result.critic) : null,
          verifiedAt: new Date(),
          repairAttempts: mod.repairAttempts + result.passes,
          versions: {
            create: {
              version: versionNo,
              contentMarkdown: result.markdown,
              changeNote: `perbaikan terarah (${result.appliedRevisions} klaim, ${result.passes} lintasan)`,
            },
          },
          chunks: { create: chunks.map((text, i) => ({ chunkIndex: i, text, embedding: "[]" })) },
          ...(excerptData.length ? { excerpts: { create: excerptData } } : {}),
        },
      }),
    ]);
  } else {
    // A pass ran but changed nothing (model skipped every claim, or the call
    // failed). Still record the spent attempt + the fresh reports: pretending no
    // attempt happened is how a budget stops bounding anything.
    await prisma.module.update({
      where: { id: mod.id, ownerId },
      data: {
        verifyReport: JSON.stringify(result.tier1),
        criticReport: result.critic ? JSON.stringify(result.critic) : null,
        verifiedAt: new Date(),
        repairAttempts: mod.repairAttempts + result.passes,
      },
    });
  }

  const attemptsUsed = mod.repairAttempts + result.passes;
  const exhausted = attemptsUsed >= MAX_REPAIR_ATTEMPTS;
  return NextResponse.json({
    ok: true,
    changed,
    passes: result.passes,
    appliedRevisions: result.appliedRevisions,
    remainingFlags: result.remainingItems.length,
    attemptsUsed,
    attemptsMax: MAX_REPAIR_ATTEMPTS,
    // Manual review is the honest end state only once the budget is spent; with
    // budget left the student can run another targeted pass.
    manualReviewNeeded: result.manualReviewNeeded && exhausted,
    message: result.manualReviewNeeded
      ? exhausted
        ? `${result.remainingItems.length} temuan masih ada setelah ${attemptsUsed} lintasan terarah: belum bisa diperbaiki otomatis, tinjau manual.`
        : `${result.remainingItems.length} temuan masih ada. Sisa percobaan otomatis: ${MAX_REPAIR_ATTEMPTS - attemptsUsed}.`
      : "Semua temuan sudah ditangani; modul lolos Tahap 1 dan tidak ada klaim bertanda dari Tahap 2.",
    verification: verificationPayload({
      verifyReport: JSON.stringify(result.tier1),
      criticReport: result.critic ? JSON.stringify(result.critic) : null,
      verifiedAt: new Date(),
      repairAttempts: attemptsUsed,
    }),
  });
}
