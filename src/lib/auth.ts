// Minimal session auth — deliberately dependency-free.
//
// WHY NOT NextAuth/Clerk/Auth.js: the entire user population is TWO trusted
// people (me and one other student on an iPad). There is no signup, no OAuth, no
// password reset, no email, no roles. A framework for those problems would add
// megabytes of dependency and a provider account to solve a problem this file
// solves in ~200 lines: prove that a request carries a passphrase we issued a
// cookie for. Everything here is built on WebCrypto, which exists in BOTH the
// Node route-handler runtime and the proxy runtime, so `proxy.ts` and the route
// handlers can share one verifier.
//
// THREAT MODEL (honest about its limits):
//   - Stops: the open internet writing to the 24 previously world-writable API
//     routes, and either student reading the other's data.
//   - Does NOT stop: someone who has the passphrase, or who can read the
//     SESSION_SECRET. There is no second factor and no device binding.
//
// The session is a stateless signed token (HMAC-SHA256), not a DB row: with two
// users, a sessions table would only add a query per request and a revocation
// story nobody will use. Rotate SESSION_SECRET to invalidate every session.
//
// This module imports NOTHING from `next` and NOTHING from prisma on purpose:
// `proxy.ts` runs outside the app's module graph and must stay lightweight.

/** Cookie that carries the signed session. */
export const SESSION_COOKIE = "so_session";

/** How long a login lasts. Long by design: an installed iPad PWA that logs the
 *  student out every week would be abandoned, and re-auth costs a passphrase
 *  entry on a touch keyboard. 90 days, sliding on each successful login. */
export const SESSION_TTL_DAYS = 90;

const TOKEN_VERSION = "v1";

/** PBKDF2 work factor. OWASP's floor for PBKDF2-SHA256 is 600k; login happens
 *  at most a handful of times per user per quarter, so we can afford it. */
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEY_BITS = 256;
const SALT_BYTES = 16;

/** Minimum passphrase length accepted by the seeder. Short passphrases are the
 *  whole attack surface here: the login endpoint is public by necessity. */
export const MIN_PASSPHRASE_LENGTH = 12;

/**
 * Thrown when the deployment is missing SESSION_SECRET. Auth FAILS CLOSED: with
 * no key we cannot distinguish a forged cookie from a real one, so every request
 * is rejected rather than waved through. A misconfigured deploy must look broken,
 * not look open.
 */
export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Byte comparison whose duration does not depend on WHERE the first difference
 * is. `a === b` on strings can early-exit and leak the matching prefix length,
 * which is enough to forge a signature one byte at a time.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  // Length is not secret (both are fixed-size digests), so an early return here
  // leaks nothing an attacker cannot already measure.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new AuthConfigError(
      "SESSION_SECRET is not set. Generate one (`openssl rand -base64 48`) and " +
        "set it in the environment — authentication is disabled-closed without it.",
    );
  }
  // A 8-char secret is a rounding error against HMAC-SHA256; refuse to pretend.
  if (secret.length < 16) {
    throw new AuthConfigError("SESSION_SECRET must be at least 16 characters.");
  }
  return secret;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(payload: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(payload));
  return toBase64Url(new Uint8Array(sig));
}

/**
 * Mint a session token for `userId`. Format: `v1.<b64u(userId)>.<expiryMs>.<sig>`
 * where the signature covers everything before it, so neither the user id nor the
 * expiry can be edited without invalidating the token. The expiry is inside the
 * signed payload rather than left to the cookie's Max-Age, because a client
 * controls its own cookie jar and can keep sending an "expired" cookie forever.
 */
export async function createSessionToken(
  userId: string,
  opts: { ttlDays?: number; now?: Date } = {},
): Promise<string> {
  const ttlDays = opts.ttlDays ?? SESSION_TTL_DAYS;
  const now = opts.now ?? new Date();
  const expiresAt = now.getTime() + ttlDays * 24 * 60 * 60 * 1000;
  const payload = `${TOKEN_VERSION}.${toBase64Url(encoder.encode(userId))}.${expiresAt}`;
  return `${payload}.${await sign(payload)}`;
}

export interface SessionClaims {
  userId: string;
  expiresAt: number;
}

/**
 * Verify a token and return its claims, or null when it is absent, malformed,
 * wrongly signed or expired. Never throws for a bad token — a hostile cookie is
 * an expected input, not an exception — but DOES propagate AuthConfigError,
 * because "we have no key" is an operator error the deploy must surface.
 */
export async function verifySessionToken(
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<SessionClaims | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, encodedUserId, expiryRaw, providedSig] = parts;
  if (version !== TOKEN_VERSION) return null;

  const payload = `${version}.${encodedUserId}.${expiryRaw}`;
  let expected: string;
  try {
    expected = await sign(payload);
  } catch (e) {
    if (e instanceof AuthConfigError) throw e;
    return null;
  }

  let providedBytes: Uint8Array;
  let expectedBytes: Uint8Array;
  try {
    providedBytes = fromBase64Url(providedSig);
    expectedBytes = fromBase64Url(expected);
  } catch {
    return null;
  }
  if (!timingSafeEqual(providedBytes, expectedBytes)) return null;

  const expiresAt = Number(expiryRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return null;

  let userId: string;
  try {
    userId = new TextDecoder().decode(fromBase64Url(encodedUserId));
  } catch {
    return null;
  }
  if (!userId) return null;

  return { userId, expiresAt };
}

/** Pull the session token out of a raw `Cookie:` header value. */
export function readSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

/**
 * Cookie attributes for the session.
 *
 * `Secure` is decided by the REQUEST's scheme, not by NODE_ENV. That distinction
 * is load-bearing: a `Secure` cookie is silently DISCARDED over plain http, and
 * this app is genuinely used both ways — the real deployment is HTTPS (where the
 * flag is mandatory), while the iPad install is smoke-tested against a production
 * build on the LAN over http first. Keying off NODE_ENV made that LAN login
 * succeed with a 200 and then never stick, which looks exactly like a broken
 * passphrase. Keying off the scheme is both safer (every https request gets the
 * flag, including a production build run locally) and honest (http cannot carry a
 * Secure cookie, so there is nothing to protect there anyway).
 *
 * `SameSite=Lax` (not Strict) so a home-screen launch that navigates in still
 * carries the cookie.
 */
export function sessionCookieAttributes(maxAgeSeconds: number, secure: boolean): string {
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${maxAgeSeconds}`;
}

/**
 * Was this request delivered over TLS? Trusts `x-forwarded-proto` because the
 * app runs behind a platform proxy (Vercel always sets it); falls back to the
 * request URL's own scheme when there is no proxy.
 */
export function isSecureRequest(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim().toLowerCase() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** `Set-Cookie` value that installs a session. */
export function serializeSessionCookie(token: string, secure: boolean): string {
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${sessionCookieAttributes(maxAge, secure)}`;
}

/** `Set-Cookie` value that removes a session (logout). */
export function serializeClearedSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; ${sessionCookieAttributes(0, secure)}`;
}

// ---------------------------------------------------------------------------
// Passphrase hashing
// ---------------------------------------------------------------------------

async function pbkdf2(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    // `salt` is a Uint8Array over a plain ArrayBuffer; the cast keeps TS happy
    // across lib.dom's BufferSource definition without copying the bytes.
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    PBKDF2_KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Hash a passphrase for storage: `pbkdf2$sha256$<iterations>$<salt>$<hash>`.
 * The parameters are stored WITH the hash so raising the work factor later does
 * not invalidate existing users' passphrases.
 */
export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(passphrase, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

/**
 * Check a passphrase against a stored hash. Returns false (never throws) for a
 * malformed or unknown-format record: a corrupt row must deny access, not crash
 * the login route into a 500 that leaks which user exists.
 */
export async function verifyPassphrase(passphrase: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5) return false;
  const [scheme, digest, iterationsRaw, saltRaw, hashRaw] = parts;
  if (scheme !== "pbkdf2" || digest !== "sha256") return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 1_000) return false;
  try {
    const salt = fromBase64Url(saltRaw);
    const expected = fromBase64Url(hashRaw);
    const actual = await pbkdf2(passphrase, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
