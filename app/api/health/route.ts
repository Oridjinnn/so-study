import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health -> 200 { ok: true, db: "up", ... } | 503
 *
 * Exists to answer one question after a deploy: "is this instance actually
 * talking to the hosted Postgres?" That used to be unanswerable — the app ran on
 * a local SQLite file, so a serverless instance would happily serve an empty
 * database and look fine.
 *
 * Deliberately public (see proxy.ts) and deliberately content-free: it reports
 * liveness and whether users have been seeded, never any study data, never the
 * connection string, never a version that helps fingerprint the host. `SELECT 1`
 * plus a count are cheap enough that a public probe is not a lever.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    // Seeded-user count is the other half of "is this deploy usable at all":
    // a healthy DB with zero users means nobody can log in.
    const users = await prisma.user.count();
    return NextResponse.json({
      ok: true,
      db: "up",
      users,
      latencyMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    });
  } catch {
    // No error detail: a Prisma connection error string contains the host and
    // database name.
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
