import { NextResponse } from "next/server";
import { checkSecret } from "@/src/lib/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel cron hook — fired once/day at ~08:00 WIB (01:00 UTC; see vercel.json).
 *
 * This is a guarded no-op: local-first, single-user, and there is NO push
 * channel, so the server cannot message the student. The real daily reminder
 * lives client-side in <SosoReminder>, which reads today's progress and renders
 * Soso's nudge. This endpoint exists so the once/day cron scaffold is honest and
 * protected, and to give a future server-side trigger a place to hook in.
 */
export async function GET(request: Request) {
  try {
    if (!checkSecret(request, process.env.CRON_SECRET)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
