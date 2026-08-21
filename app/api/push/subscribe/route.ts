import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";

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

export async function POST(req: NextRequest) {
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

  // Re-subscribing just rotates the keys — upsert on the unique endpoint.
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { p256dh: keys.p256dh, auth: keys.auth },
  });

  // Persist the student name (single-user settings singleton) when provided, so
  // the server-side push copy can personalize. Never overwrites with empty.
  const name = studentName && studentName.length > 0 ? studentName : undefined;
  await prisma.settings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", studentName: name },
    update: name ? { studentName: name } : {},
  });

  return NextResponse.json({ ok: true });
}
