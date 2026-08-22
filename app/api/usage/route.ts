import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { getBudgetStatus } from "@/src/lib/aiusage";
import { requireUser } from "@/src/lib/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cost-observability summary for the "Biaya AI" panel (whitepaper §3 / §7).
// The existing `usage` rollup is kept byte-for-byte so the DOM test and other
// callers are unaffected; the new `budget` object is purely additive (workstream
// C) and exposes the hard daily/monthly Gemini cap alongside the per-kind spend.
//
// DELIBERATELY NOT OWNER-SCOPED. AIUsage tracks one shared Gemini key and one
// shared wallet: both students spend from the same cap, so splitting the rollup
// per user would show each of them a number that does not explain why their
// calls got a 429. The tenancy requirement here is authentication only — a
// session is still mandatory, because the spend pattern (and the topic-level
// activity it implies) is not something an anonymous visitor may read.
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const rows = await prisma.aIUsage.groupBy({
    by: ["kind"],
    _count: { _all: true },
    _sum: { tokensIn: true, tokensOut: true, estimatedCost: true },
  });
  const budget = await getBudgetStatus();
  return NextResponse.json({
    usage: rows.map((r) => ({
      kind: r.kind,
      calls: r._count._all,
      tokensIn: r._sum.tokensIn ?? 0,
      tokensOut: r._sum.tokensOut ?? 0,
      estimatedCost: r._sum.estimatedCost ?? 0,
    })),
    budget,
  });
}
