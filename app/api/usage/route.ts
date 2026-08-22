import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { getBudgetStatus } from "@/src/lib/aiusage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cost-observability summary for the "Biaya AI" panel (whitepaper §3 / §7).
// The existing `usage` rollup is kept byte-for-byte so the DOM test and other
// callers are unaffected; the new `budget` object is purely additive (workstream
// C) and exposes the hard daily/monthly Gemini cap alongside the per-kind spend.
export async function GET() {
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
