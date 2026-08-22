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

/** Per-user outcome, aggregated into the response for observability. */
interface UserResult {
  /** Opaque cuid. Harmless to expose: this endpoint is CRON_SECRET-guarded, and
   *  a user id grants nothing without a signed session cookie. */
  userId: string;
  sent: number;
  stale: number;
  /** Why this user got nothing: "studied_today" | "no_subscription" | "error". */
  skipped?: string;
}

/**
 * Decide and deliver ONE user's nudge. Everything it touches is filtered by that
 * user: their attempts, their Settings row, their subscriptions. Returns the
 * stale subscription ids for the caller to delete in one batch.
 *
 * Errors are caught per user, deliberately: with two students sharing the cron
 * run, one failing DB read or one malformed Settings row must not swallow the
 * other person's reminder for the day.
 */
async function notifyUser(
  userId: string,
  start: Date,
  end: Date,
): Promise<{ result: UserResult; staleIds: string[] }> {
  try {
    // (1) Did THIS user study today (WIB)? AssessmentAttempt has no ownerId, so
    // ownership runs through the topic relation. Unscoped — as this was before —
    // MY practice session counted as HER activity and suppressed her nudge.
    const activity = await prisma.assessmentAttempt.findFirst({
      where: { answeredAt: { gte: start, lte: end }, topic: { ownerId: userId } },
      select: { id: true },
    });
    if (activity) {
      return { result: { userId, sent: 0, stale: 0, skipped: "studied_today" }, staleIds: [] };
    }

    // (2) Personalize from THIS user's settings (Settings is keyed by userId; the
    // old "singleton" row is gone), then rotate the copy bank per person so both
    // students get variety independently instead of sharing one cursor.
    const settings = await prisma.settings.findUnique({ where: { userId } });
    const { copyId, title, body } = pickPushCopy(
      settings?.studentName ?? null,
      settings?.lastNotificationCopyId ?? null,
    );
    const payload = JSON.stringify({ title, body });

    // (3) Deliver ONLY to this user's devices. This is the line that used to send
    // her copy, addressed with her name, to my iPad.
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) {
      return { result: { userId, sent: 0, stale: 0, skipped: "no_subscription" }, staleIds: [] };
    }

    let sent = 0;
    const staleIds: string[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) staleIds.push(s.id);
      }
    }

    // Record which copy this user just got so their next send rotates away from
    // it. Written per user, so my send never advances her rotation.
    if (sent > 0) {
      await prisma.settings.upsert({
        where: { userId },
        create: { userId, lastNotificationCopyId: copyId },
        update: { lastNotificationCopyId: copyId },
      });
    }

    return { result: { userId, sent, stale: staleIds.length }, staleIds };
  } catch {
    return { result: { userId, sent: 0, stale: 0, skipped: "error" }, staleIds: [] };
  }
}

/**
 * Vercel cron hook — fired once/day at ~20:00 WIB (13:00 UTC; see vercel.json).
 *
 * Sends a playful Soso "you haven't studied today" push. Cron carries NO cookie,
 * so this route is deliberately exempt from `requireUser` and guarded by
 * CRON_SECRET instead (see the allowlist in app/api/route-guard.test.ts). That
 * exemption is exactly why the per-user correctness has to be explicit here:
 * there is no session to scope the work, so the route iterates the users that
 * actually have subscriptions and answers "has THIS student studied today?" for
 * each of them separately. Previously it asked the question once, globally, which
 * with two students meant her nudge went to my device and my studying silenced
 * hers.
 *
 * A send that 404/410s means the subscription expired/revoked — we delete it so
 * dead subscriptions don't pile up and fail silently.
 *
 * Response stays backward-compatible: `{ ok, sent, stale }` where sent/stale are
 * the totals across users, plus the pre-existing top-level `skipped` when the
 * whole run was a no-op for one reason. `users` is additive per-user detail.
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

    // The set of people to consider is derived from the subscriptions themselves,
    // not from the User table: a student with no installed device is not a
    // recipient, and iterating every user would query attempts for nothing.
    const subscribers = await prisma.pushSubscription.findMany({
      distinct: ["userId"],
      select: { userId: true },
      orderBy: { userId: "asc" },
    });
    if (subscribers.length === 0) {
      return NextResponse.json({ ok: true, skipped: "no_subscription", sent: 0, stale: 0, users: [] });
    }

    const start = startOfTodayJakarta();
    const end = new Date(start.getTime() + DAY_MS - 1);

    const users: UserResult[] = [];
    const staleIds: string[] = [];
    // Sequential on purpose: two users, a handful of devices each. Parallelism
    // here would only add concurrent connections to a serverless Postgres pool.
    for (const { userId } of subscribers) {
      const { result, staleIds: theirs } = await notifyUser(userId, start, end);
      users.push(result);
      staleIds.push(...theirs);
    }

    // Drop expired/revoked subscriptions instead of failing silently forever.
    // One batch for the whole run — the ids are globally unique.
    if (staleIds.length > 0) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
    }

    const sent = users.reduce((n, u) => n + u.sent, 0);

    // Preserve the old single-user response for the case it described: when the
    // entire run was skipped for ONE shared reason (typically "studied_today"),
    // the top-level `skipped` still says so.
    const reasons = new Set(users.map((u) => u.skipped ?? "sent"));
    const uniformSkip = sent === 0 && reasons.size === 1 && !reasons.has("sent")
      ? [...reasons][0]
      : null;

    return NextResponse.json({
      ok: true,
      sent,
      stale: staleIds.length,
      ...(uniformSkip ? { skipped: uniformSkip } : {}),
      users,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
