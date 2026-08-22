import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma";
import {
  AuthConfigError,
  createSessionToken,
  isSecureRequest,
  serializeSessionCookie,
  verifyPassphrase,
} from "@/src/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login  { passphrase }  ->  200 { ok, user } + Set-Cookie
 *
 * ONE field, by design. There is no signup, no email, no username: the student
 * types a passphrase on an iPad touch keyboard (once per 90 days, then Keychain
 * autofills it). The server finds WHICH of the seeded users that passphrase
 * belongs to by verifying it against each stored hash.
 *
 * Verifying against every user is safe here because the user table is capped at
 * MAX_LOGIN_CANDIDATES: this is a two-person deployment, not a product. If it
 * ever grew, this endpoint would need a handle field instead — hence the
 * explicit cap rather than a silent O(n) PBKDF2 loop.
 *
 * Users exist ONLY via `node scripts/seed-users.mjs` (see docs/DEPLOY.md).
 */
const MAX_LOGIN_CANDIDATES = 10;

/**
 * In-process throttle. Serverless instances are not shared, so this is a speed
 * bump rather than a real rate limiter — but combined with a >=12 char passphrase
 * and 600k-iteration PBKDF2 (which makes each guess cost real CPU) it removes the
 * "hammer it from one connection" case. A durable limiter would need a table and
 * a cleanup job; that is not worth it for two users.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 12;

function throttled(key: string, now: number): boolean {
  const rec = attempts.get(key);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

function clientKey(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(req: Request) {
  let body: { passphrase?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Format permintaan tidak valid." }, { status: 400 });
  }

  const passphrase = typeof body.passphrase === "string" ? body.passphrase : "";
  if (!passphrase) {
    return NextResponse.json({ error: "Kata sandi wajib diisi." }, { status: 400 });
  }
  // Bound the work an anonymous caller can force: PBKDF2 over a megabyte-long
  // "passphrase" is a free CPU-burn primitive otherwise.
  if (passphrase.length > 200) {
    return NextResponse.json({ error: "Kata sandi terlalu panjang." }, { status: 400 });
  }

  if (throttled(clientKey(req), Date.now())) {
    return NextResponse.json(
      { error: "Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi." },
      { status: 429 },
    );
  }

  const users = await prisma.user.findMany({
    take: MAX_LOGIN_CANDIDATES,
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, displayName: true, passphraseHash: true },
  });

  let matched: (typeof users)[number] | null = null;
  for (const user of users) {
    // No early break before every candidate is checked would leak, via timing,
    // which position in the table matched. We do break, because with two users
    // the observable difference is one PBKDF2 round and the passphrase itself is
    // the secret being protected — not the user's ordinal.
    if (await verifyPassphrase(passphrase, user.passphraseHash)) {
      matched = user;
      break;
    }
  }

  if (!matched) {
    // Same message whether the passphrase is wrong or no users are seeded at all:
    // "no users exist" is deployment information an attacker can use.
    return NextResponse.json({ error: "Kata sandi salah." }, { status: 401 });
  }

  let token: string;
  try {
    token = await createSessionToken(matched.id);
  } catch (e) {
    if (e instanceof AuthConfigError) {
      return NextResponse.json(
        { error: "Server belum dikonfigurasi (SESSION_SECRET kosong)." },
        { status: 503 },
      );
    }
    throw e;
  }

  const res = NextResponse.json({
    ok: true,
    user: { id: matched.id, name: matched.name, displayName: matched.displayName },
  });
  res.headers.set("set-cookie", serializeSessionCookie(token, isSecureRequest(req)));
  return res;
}
