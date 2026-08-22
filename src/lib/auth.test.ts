import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  AuthConfigError,
  MIN_PASSPHRASE_LENGTH,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  createSessionToken,
  hashPassphrase,
  isSecureRequest,
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  verifyPassphrase,
  verifySessionToken,
} from "./auth";

const SECRET = process.env.SESSION_SECRET;

afterEach(() => {
  process.env.SESSION_SECRET = SECRET;
  delete process.env.NODE_ENV_OVERRIDE;
});

describe("session tokens", () => {
  it("round-trips the user id", async () => {
    const token = await createSessionToken("user-123");
    await expect(verifySessionToken(token)).resolves.toEqual({
      userId: "user-123",
      expiresAt: expect.any(Number),
    });
  });

  it("rejects a token whose user id was edited", async () => {
    const token = await createSessionToken("user-123");
    const parts = token.split(".");
    // Swap the payload's user id but keep the original signature — the classic
    // "just change the id" forgery.
    const forged = [parts[0], Buffer.from("user-999").toString("base64url"), parts[2], parts[3]].join(
      ".",
    );
    await expect(verifySessionToken(forged)).resolves.toBeNull();
  });

  it("rejects a token whose expiry was pushed into the future", async () => {
    const token = await createSessionToken("user-123");
    const parts = token.split(".");
    const forged = [parts[0], parts[1], String(Date.now() + 10 ** 12), parts[3]].join(".");
    await expect(verifySessionToken(forged)).resolves.toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken("user-123");
    process.env.SESSION_SECRET = "a-completely-different-secret-value";
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("rejects an expired token even though the signature is valid", async () => {
    const token = await createSessionToken("user-123", { ttlDays: 1 });
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await expect(verifySessionToken(token, later)).resolves.toBeNull();
  });

  it("expires ~SESSION_TTL_DAYS out by default", async () => {
    const token = await createSessionToken("user-123");
    const claims = await verifySessionToken(token);
    const days = ((claims?.expiresAt ?? 0) - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(SESSION_TTL_DAYS - 1);
    expect(days).toBeLessThanOrEqual(SESSION_TTL_DAYS);
  });

  it.each([
    ["empty", ""],
    ["garbage", "not-a-token"],
    ["wrong version", "v2.abc.123.sig"],
    ["too few segments", "v1.abc.123"],
    ["too many segments", "v1.abc.123.sig.extra"],
  ])("returns null for a %s token instead of throwing", async (_label, token) => {
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("returns null for a missing token", async () => {
    await expect(verifySessionToken(null)).resolves.toBeNull();
    await expect(verifySessionToken(undefined)).resolves.toBeNull();
  });

  it("FAILS CLOSED when SESSION_SECRET is unset", async () => {
    const token = await createSessionToken("user-123");
    delete process.env.SESSION_SECRET;
    // Not "returns null and carries on": the operator error must be visible.
    await expect(verifySessionToken(token)).rejects.toBeInstanceOf(AuthConfigError);
    await expect(createSessionToken("user-123")).rejects.toBeInstanceOf(AuthConfigError);
  });

  it("refuses a trivially short SESSION_SECRET", async () => {
    process.env.SESSION_SECRET = "short";
    await expect(createSessionToken("user-123")).rejects.toBeInstanceOf(AuthConfigError);
  });
});

describe("cookie handling", () => {
  it("reads the session cookie out of a crowded header", () => {
    const header = `theme=dark; ${SESSION_COOKIE}=abc123; other=1`;
    expect(readSessionCookie(header)).toBe("abc123");
  });

  it("url-decodes the value it stored", async () => {
    const token = await createSessionToken("user-123");
    const setCookie = serializeSessionCookie(token, true);
    const value = setCookie.split(";")[0];
    expect(readSessionCookie(value)).toBe(token);
  });

  it("ignores a cookie whose name merely contains the session name", () => {
    expect(readSessionCookie(`not_${SESSION_COOKIE}=abc`)).toBeNull();
  });

  it("returns null for a missing or empty header", () => {
    expect(readSessionCookie(null)).toBeNull();
    expect(readSessionCookie("")).toBeNull();
    expect(readSessionCookie(`${SESSION_COOKIE}=`)).toBeNull();
  });

  it("marks the cookie HttpOnly, Lax and path-wide", async () => {
    const setCookie = serializeSessionCookie(await createSessionToken("u"), true);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain(`Max-Age=${SESSION_TTL_DAYS * 24 * 60 * 60}`);
  });

  it("sets Secure over https and omits it over http", async () => {
    const token = await createSessionToken("u");
    // Over plain http a Secure cookie is DISCARDED by the browser, so a login
    // would 200 and never stick — the LAN-testing failure mode this guards.
    expect(serializeSessionCookie(token, true)).toContain("; Secure");
    expect(serializeSessionCookie(token, false)).not.toContain("Secure");
  });

  it("clears the cookie with Max-Age=0, mirroring the Secure flag", () => {
    expect(serializeClearedSessionCookie(true)).toContain("Max-Age=0");
    expect(serializeClearedSessionCookie(true)).toContain("; Secure");
    expect(serializeClearedSessionCookie(false)).not.toContain("Secure");
  });

  it.each([
    ["x-forwarded-proto: https", { "x-forwarded-proto": "https" }, true],
    ["x-forwarded-proto: http", { "x-forwarded-proto": "http" }, false],
    ["a proxy chain starting https", { "x-forwarded-proto": "https, http" }, true],
  ])("derives Secure from %s", (_label, headers, expected) => {
    const req = {
      url: "http://192.168.0.10:3000/api/auth/login",
      headers: { get: (n: string) => (headers as Record<string, string>)[n.toLowerCase()] ?? null },
    } as unknown as Request;
    expect(isSecureRequest(req)).toBe(expected);
  });

  it("falls back to the request URL scheme with no proxy header", () => {
    const make = (url: string) =>
      ({ url, headers: { get: () => null } }) as unknown as Request;
    expect(isSecureRequest(make("https://so-study.example/api/x"))).toBe(true);
    expect(isSecureRequest(make("http://localhost:3000/api/x"))).toBe(false);
    expect(isSecureRequest(make("not a url"))).toBe(false);
  });
});

describe("passphrase hashing", () => {
  // PBKDF2 at 600k iterations is intentionally slow; these run a handful of
  // derivations, so give them room without hiding a real hang.
  it(
    "verifies the right passphrase and rejects the wrong one",
    async () => {
      const stored = await hashPassphrase("kata-sandi-yang-panjang");
      await expect(verifyPassphrase("kata-sandi-yang-panjang", stored)).resolves.toBe(true);
      await expect(verifyPassphrase("kata-sandi-yang-panjanG", stored)).resolves.toBe(false);
      await expect(verifyPassphrase("", stored)).resolves.toBe(false);
    },
    30_000,
  );

  it(
    "salts: the same passphrase hashes differently every time",
    async () => {
      const a = await hashPassphrase("kata-sandi-yang-panjang");
      const b = await hashPassphrase("kata-sandi-yang-panjang");
      expect(a).not.toEqual(b);
    },
    30_000,
  );

  it("stores scheme, digest and iteration count alongside the hash", async () => {
    const stored = await hashPassphrase("kata-sandi-yang-panjang");
    const [scheme, digest, iterations] = stored.split("$");
    expect(scheme).toBe("pbkdf2");
    expect(digest).toBe("sha256");
    expect(Number(iterations)).toBeGreaterThanOrEqual(600_000);
  }, 30_000);

  it.each([
    ["empty", ""],
    ["not our format", "plaintext"],
    ["unknown scheme", "bcrypt$sha256$1000$c2FsdA$aGFzaA"],
    ["unknown digest", "pbkdf2$md5$1000$c2FsdA$aGFzaA"],
    ["absurdly low iterations", "pbkdf2$sha256$1$c2FsdA$aGFzaA"],
  ])("denies access for a %s stored hash instead of crashing", async (_label, stored) => {
    await expect(verifyPassphrase("anything", stored)).resolves.toBe(false);
  });
});

describe("scripts/seed-users.mjs stays format-compatible", () => {
  // The seeder cannot import this TypeScript module (it runs under bare `node`),
  // so it reimplements the hash. If the two ever disagree, every seeded user is
  // locked out with no error message — hence this test.
  it("hashes with the same scheme, digest and iteration count", async () => {
    const seeder = readFileSync("scripts/seed-users.mjs", "utf8");
    expect(seeder).toContain("pbkdf2$sha256$");
    expect(seeder).toMatch(/PBKDF2_ITERATIONS\s*=\s*600_000/);
    expect(seeder).toMatch(/KEY_BYTES\s*=\s*32/);
    expect(seeder).toContain('"sha256"');
    expect(seeder).toMatch(/base64url/);
    // And it must enforce the same minimum length the app documents.
    expect(seeder).toMatch(
      new RegExp(`MIN_PASSPHRASE_LENGTH\\s*=\\s*${MIN_PASSPHRASE_LENGTH}`),
    );
  });

  it("hashes produced by the seeder's algorithm verify here", async () => {
    // Reproduce the seeder's node:crypto path and check this module accepts it.
    const { pbkdf2Sync, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16);
    const iterations = 600_000;
    const hash = pbkdf2Sync("kata-sandi-yang-panjang", salt, iterations, 32, "sha256");
    const stored = `pbkdf2$sha256$${iterations}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
    await expect(verifyPassphrase("kata-sandi-yang-panjang", stored)).resolves.toBe(true);
  }, 30_000);
});
