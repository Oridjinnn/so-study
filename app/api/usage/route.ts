import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cost-observability summary for the "Biaya AI" panel (whitepaper §3 / §7).
export async function GET() {
  const rows = await prisma.aIUsage.groupBy({
    by: ["kind"],
    _count: { _all: true },
    _sum: { tokensIn: true, tokensOut: true, estimatedCost: true },
  });
  return NextResponse.json({
    usage: rows.map((r) => ({
      kind: r.kind,
      calls: r._count._all,
      tokensIn: r._sum.tokensIn ?? 0,
      tokensOut: r._sum.tokensOut ?? 0,
      estimatedCost: r._sum.estimatedCost ?? 0,
    })),
  });
}
