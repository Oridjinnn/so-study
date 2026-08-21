import { NextResponse } from "next/server";
import * as webpush from "web-push";
import { prisma } from "@/src/lib/prisma";
import { checkSecret } from "@/src/lib/cronAuth";
import { pickPushCopy } from "@/app/lib/soso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// WIB (Asia/Jakarta) is UTC+7. Activity is judged on the Jakarta calendar day,
// not server UTC, so the "haven't studied today" check aligns with the student.
const DAY_MS = 24 * 60 * 60 * 1000;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function jakartaDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Instant (UTC) for 00:00 WIB of the Jakarta today.
function startOfTodayJakarta(): Date {
  const [y, m, day] = jakartaDayKey(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day) - WIB_OFFSET_MS);
}

/**
 * Vercel cron hook — fired once/day at ~20:00 WIB (13:00 UTC; see vercel.json).
 *
 * Sends a playful Soso "you haven't studied today" push to every subscribed
 * device, but ONLY when: (1) at least one PushSubscription exists, AND (2) the
 * student has NO study activity (AssessmentAttempt) in the Jakarta today. A send
 * that 404/410s means the subscription expired/revoked — we delete it so dead
 * subscriptions don't pile up and fail silently. Guarded by CRON_SECRET.
 */
export async function GET(request: Request) {
  try {
    if (!checkSecret(request, process.env.CRON_SECRET)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const subject = process.env.VAPID_SUBJECT;
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!subject || !publicKey || !privateKey) {
      return NextResponse.json({ ok: false, error: "vapid not configured" }, { status: 500 });
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);

    // (1) At least one subscription?
    const anySub = await prisma.pushSubscription.findFirst();
    if (!anySub) {
      return NextResponse.json({ ok: true, skipped: "no_subscription" });
    }

    // (2) Studied today (WIB) already?
    const start = startOfTodayJakarta();
    const end = new Date(start.getTime() + DAY_MS - 1);
    const activity = await prisma.assessmentAttempt.findFirst({
      where: { answeredAt: { gte: start, lte: end } },
      select: { id: true },
    });
    if (activity) {
      return NextResponse.json({ ok: true, skipped: "studied_today" });
    }

    // Personalize from the singleton settings, then rotate the copy bank.
    const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
    const { copyId, title, body } = pickPushCopy(
      settings?.studentName ?? null,
      settings?.lastNotificationCopyId ?? null,
    );
    const payload = JSON.stringify({ title, body });

    const subs = await prisma.pushSubscription.findMany();
    let sent = 0;
    const stale: string[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) stale.push(s.id);
      }
    }

    // Drop expired/revoked subscriptions instead of failing silently forever.
    if (stale.length > 0) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: stale } } });
    }

    // Record which copy we just sent so the next send rotates to a different one.
    if (sent > 0) {
      await prisma.settings.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", lastNotificationCopyId: copyId },
        update: { lastNotificationCopyId: copyId },
      });
    }

    return NextResponse.json({ ok: true, sent, stale: stale.length });
  } catch {
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
