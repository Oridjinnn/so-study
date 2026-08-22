import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { requireUser } from "@/src/lib/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The PushSubscription the browser hands us. `keys` is the standard
// { p256dh, auth } pair; both are base64url-encoded strings.
const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  studentName: z.string().trim().max(120).optional(),
});

// Unlike its sibling `push/send`, this IS a browser call from the installed PWA,
// so it carries the session cookie and must be authenticated: the subscription
// decides WHOSE nudges a device receives, so accepting it anonymously would let
// anyone register an endpoint that then gets another student's reminder — or,
// worse, silently re-point an existing device at the wrong person.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const userId = auth.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid subscription" }, { status: 400 });
  }

  const { endpoint, keys, studentName } = parsed.data;

  // Re-subscribing just rotates the keys — upsert on the globally unique
  // endpoint (it identifies one browser push context, so it stays the natural
  // key). `userId` is written on UPDATE as well as CREATE on purpose: on a shared
  // iPad, whoever is logged in when the endpoint is re-registered is the person
  // that device now belongs to, and leaving a stale owner would keep delivering
  // the previous student's "kamu belum belajar" nudge to the new one.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, userId, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth },
  });

  // Persist the student name in THIS user's settings row (Settings is keyed by
  // userId now — there is no "singleton" row any more), so the server-side push
  // copy personalizes the right person. Never overwrites with empty.
  const name = studentName && studentName.length > 0 ? studentName : undefined;
  await prisma.settings.upsert({
    where: { userId },
    create: { userId, studentName: name },
    update: name ? { studentName: name } : {},
  });

  return NextResponse.json({ ok: true });
}
