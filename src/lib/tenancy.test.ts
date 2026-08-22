import { describe, expect, it, afterEach } from "vitest";
import { requireUser, notFoundForUser } from "./tenancy";
import { SESSION_COOKIE, createSessionToken } from "./auth";
import { TEST_USER_ID, anonymousHeaders, authedHeaders } from "./testAuth";

const SECRET = process.env.SESSION_SECRET;
afterEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

function req(headers: { get: (name: string) => string | null }): Request {
  return { headers } as unknown as Request;
}

describe("requireUser", () => {
  it("resolves the user id from a valid session cookie", async () => {
    const result = await requireUser(req(await authedHeaders()));
    expect(result).toEqual({ ok: true, userId: TEST_USER_ID });
  });

  it("401s a request with no cookie at all", async () => {
    const result = await requireUser(req(anonymousHeaders()));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(401);
    await expect(result.response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("401s a tampered token rather than trusting it", async () => {
    const token = await createSessionToken("someone-else");
    const tampered = `${token.slice(0, -4)}AAAA`;
    const result = await requireUser(req(anonymousHeaders({ cookie: `${SESSION_COOKIE}=${tampered}` })));
    expect(result.ok).toBe(false);
  });

  it("401s an expired session", async () => {
    // Mint a token that expired yesterday: signature valid, claim stale.
    const token = await createSessionToken("u", {
      ttlDays: 1,
      now: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
    const result = await requireUser(req(anonymousHeaders({ cookie: `${SESSION_COOKIE}=${token}` })));
    expect(result.ok).toBe(false);
  });

  it("does NOT trust a caller-supplied user header", async () => {
    // The proxy could inject identity headers; routes deliberately ignore them so
    // a request that bypasses the proxy cannot self-identify.
    const result = await requireUser(
      req(anonymousHeaders({ "x-so-user": "admin", "x-user-id": "admin" })),
    );
    expect(result.ok).toBe(false);
  });

  it("503s (never 200) when the deployment has no SESSION_SECRET", async () => {
    const headers = await authedHeaders();
    delete process.env.SESSION_SECRET;
    const result = await requireUser(req(headers));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(503);
  });
});

describe("notFoundForUser", () => {
  it("is a 404, not a 403 — another student's ids stay unconfirmed", async () => {
    const res = notFoundForUser("Modul");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Modul tidak ditemukan." });
  });
});
