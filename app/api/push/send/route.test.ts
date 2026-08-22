import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("web-push", () => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => {
  const pushSubscription = { findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() };
  const assessmentAttempt = { findFirst: vi.fn() };
  const settings = { findUnique: vi.fn(), upsert: vi.fn() };
  return { prisma: { pushSubscription, assessmentAttempt, settings } };
});

import { GET } from "./route";
import { prisma } from "@/src/lib/prisma";
import * as webpush from "web-push";

const pushSubscription = prisma.pushSubscription as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
};
const assessmentAttempt = prisma.assessmentAttempt as unknown as { findFirst: ReturnType<typeof vi.fn> };
const settings = prisma.settings as unknown as { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
const send = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;

const savedEnv = { ...process.env };

function req() {
  return new Request("http://x/api/push/send");
}

describe("GET /api/push/send (real web-push)", () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
    process.env.VAPID_SUBJECT = "mailto:me@example.com";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    pushSubscription.findFirst.mockReset();
    pushSubscription.findMany.mockReset();
    pushSubscription.deleteMany.mockReset();
    assessmentAttempt.findFirst.mockReset();
    settings.findUnique.mockReset();
    settings.upsert.mockReset();
    send.mockReset();
  });
  afterEach(() => {
    for (const k of ["CRON_SECRET", "VAPID_SUBJECT", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) {
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
      else delete process.env[k];
    }
  });

  it("401 when CRON_SECRET is set but no header is provided", async () => {
    process.env.CRON_SECRET = "topsecret";
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("skips when there is no subscription (nothing to send)", async () => {
    pushSubscription.findFirst.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skipped?: string };
    expect(body.skipped).toBe("no_subscription");
    expect(send).not.toHaveBeenCalled();
  });

  it("skips when the student already studied today (WIB)", async () => {
    pushSubscription.findFirst.mockResolvedValue({ id: "s1" });
    assessmentAttempt.findFirst.mockResolvedValue({ id: "a1" });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { skipped?: string };
    expect(body.skipped).toBe("studied_today");
    expect(send).not.toHaveBeenCalled();
  });

  it("sends to subscribers and drops stale (404/410) subscriptions", async () => {
    pushSubscription.findFirst.mockResolvedValue({ id: "s1" });
    assessmentAttempt.findFirst.mockResolvedValue(null);
    settings.findUnique.mockResolvedValue(null);
    pushSubscription.findMany.mockResolvedValue([
      { id: "s1", endpoint: "e1", p256dh: "p1", auth: "a1" },
      { id: "s2", endpoint: "e2", p256dh: "p2", auth: "a2" },
    ]);
    // First sub fails as expired; second succeeds.
    send.mockRejectedValueOnce({ statusCode: 410 }).mockResolvedValueOnce(undefined as never);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sent: number; stale: number };
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(1);
    expect(body.stale).toBe(1);
    expect(pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["s1"] } } });
  });

  it("500 when VAPID keys are not configured", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    pushSubscription.findFirst.mockResolvedValue({ id: "s1" });
    const res = await GET(req());
    expect(res.status).toBe(500);
  });
});
