import { NextResponse } from "next/server";
import { generate } from "@/src/lib/gemini";
import { logAIUsage, assertBudget } from "@/src/lib/aiusage";
import { prisma } from "@/src/lib/prisma";
import { notFoundForUser, requireUser } from "@/src/lib/tenancy";
import { loadModuleForVerification } from "@/src/lib/moduleSources";
import { runVerification, verificationPayload } from "@/src/lib/verification";
import { GUARD_STATUS, guardBodyBytes } from "@/src/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/modules/[id]/verify — (re-)run the accuracy verification for a module
 * and cache the result on the row.
 *
 * Tier 1 always runs: it is free, deterministic and it is the shipping gate.
 * Tier 2 (a paid Gemini call) runs only when the caller asks for it —
 * `{ "tier2": true }` — because the cost rule is "once per module, not once per
 * read". The default is therefore Tier 1 only, which is what this route is for:
 * modules generated before the gate existed, and re-checking after the approved
 * paper set changed.
 *
 * Never blocks or deletes anything: it writes a report. Whether the student may
 * read the module is decided by the UI from `tier1.blocked`.
 *
 * ORDER OF THE FOUR GATES — each one sits ahead of the cost it prevents:
 *   1. session    an anonymous caller must not be able to probe budget state and
 *                 must not cost a DB query, so 401 comes before everything.
 *   2. body size  free, header-only.
 *   3. AI budget  one aggregate query, ahead of every paid call.
 *   4. ownership  an owner-scoped read; 404 for a module that is not the
 *                 caller's, before the Tier-2 spend it would have triggered.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/modules/[id]/verify">) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const ownerId = auth.userId;

  const bodyTooBig = guardBodyBytes(req.headers.get("content-length"));
  if (bodyTooBig) {
    return NextResponse.json({ error: bodyTooBig.error }, { status: GUARD_STATUS });
  }

  // Cost gate (workstream C): the Tier-2 path below spends a Gemini call, so the
  // gate must run before runVerification() — and before the module load, which
  // is the expensive DB work. Tier-1-only runs are free but gated uniformly.
  try {
    await assertBudget();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 429 });
  }

  const { id } = await ctx.params;
  let body: { tier2?: boolean } = {};
  try {
    body = (await req.json()) as { tier2?: boolean };
  } catch {
    body = {}; // empty body is valid: Tier 1 only
  }

  // Ownership is established HERE, by folding `ownerId` into a Module read,
  // because the shared loader below (src/lib/moduleSources.ts, another
  // workstream's file) still resolves a module by id alone. This route therefore
  // never hands it an id it has not first proven belongs to the caller: a foreign
  // id gets the same 404 as a nonexistent one and never reaches the loader, the
  // approved-paper read, or a Gemini call.
  const owned = await prisma.module.findFirst({ where: { id, ownerId }, select: { id: true } });
  if (!owned) return notFoundForUser("Modul");

  const mod = await loadModuleForVerification(id);
  if (!mod) return notFoundForUser("Modul");

  const wantTier2 = body.tier2 === true;
  const { tier1, critic, gauge } = await runVerification(
    { contentMarkdown: mod.contentMarkdown, sourcePaperIds: mod.paperIds },
    mod.sources,
    {
      tier2: wantTier2,
      generate: (o) => generate(o),
      onUsage: (usage) => logAIUsage({ topicId: mod.topicId, kind: "critic", usage }),
    },
  );

  // A Tier-1-only run must not wipe a previously cached Tier 2 report: the
  // content has not changed, so those flags are still about this text.
  const updated = await prisma.module.update({
    // `ownerId` rides along into the UPDATE's WHERE clause. Prisma allows the
    // extra non-unique filter next to the unique `id`, so the write is scoped by
    // the same predicate as the read instead of trusting it.
    where: { id: mod.id, ownerId },
    data: {
      verifyReport: JSON.stringify(tier1),
      ...(critic ? { criticReport: JSON.stringify(critic) } : {}),
      verifiedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    tier2Ran: Boolean(critic?.ran),
    gauge,
    verification: verificationPayload(updated),
  });
}
