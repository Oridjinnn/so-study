import { NextResponse } from "next/server";
import { generate } from "@/src/lib/gemini";
import { logAIUsage } from "@/src/lib/aiusage";
import { prisma } from "@/src/lib/prisma";
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
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const bodyTooBig = guardBodyBytes(req.headers.get("content-length"));
  if (bodyTooBig) {
    return NextResponse.json({ error: bodyTooBig.error }, { status: GUARD_STATUS });
  }

  const { id } = await params;
  let body: { tier2?: boolean } = {};
  try {
    body = (await req.json()) as { tier2?: boolean };
  } catch {
    body = {}; // empty body is valid: Tier 1 only
  }

  const mod = await loadModuleForVerification(id);
  if (!mod) {
    return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });
  }

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
    where: { id: mod.id },
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
