import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import { requireUser } from "@/src/lib/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/session -> 200 { user } | 401
 *
 * Lets the client show WHO is logged in (and offer "Keluar") without embedding
 * the identity in the HTML, which would break the service worker's cached app
 * shell: one cached shell must be valid for either student.
 *
 * Note this is NOT in the proxy's public list — it requires a session on purpose.
 * A 401 here is the client's signal that the cookie expired.
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, name: true, displayName: true },
  });
  // A signed token for a user that no longer exists (deleted between logins) is
  // not a server error — it is an invalid session.
  if (!user) {
    return NextResponse.json({ error: "Sesi tidak valid lagi." }, { status: 401 });
  }
  return NextResponse.json({ user });
}
