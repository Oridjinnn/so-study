import { describe, expect, it, afterEach } from "vitest";
import { GET } from "./route";
import { checkSecret } from "@/src/lib/cronAuth";

function makeReq(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/cron/daily-reminder", { headers });
}

const ORIGINAL = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

describe("checkSecret", () => {
  it("allows when no secret is configured", () => {
    expect(checkSecret(makeReq(), undefined)).toBe(true);
  });
  it("rejects a wrong secret", () => {
    expect(checkSecret(makeReq({ "x-cron-secret": "nope" }), "s3cret")).toBe(false);
  });
  it("accepts the x-cron-secret header", () => {
    expect(checkSecret(makeReq({ "x-cron-secret": "s3cret" }), "s3cret")).toBe(true);
  });
  it("accepts Authorization: Bearer", () => {
    expect(checkSecret(makeReq({ authorization: "Bearer s3cret" }), "s3cret")).toBe(true);
  });
});

describe("GET /api/cron/daily-reminder", () => {
  it("returns ok in local dev (no CRON_SECRET)", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 401 when the secret is set but missing", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 200 when the secret matches", async () => {
    process.env.CRON_SECRET = "s3cret";
    const res = await GET(makeReq({ "x-cron-secret": "s3cret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
