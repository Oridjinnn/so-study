import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));

vi.mock("web-push", () => ({
  setVapidDetails: vi.fn(),
  sendNotification: (...args: unknown[]) =>
    sendNotification(args[0] as { endpoint: string }, args[1] as string),
}));

vi.mock("@/src/lib/prisma", () => {
  const pushSubscription = {
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    deleteMany: vi.fn(async () => ({})),
  };
  const settings = {
    findUnique: vi.fn(async () => null),
    upsert: vi.fn(async () => ({})),
  };
  const assessmentAttempt = {
    findFirst: vi.fn(async () => null),
  };
  return { prisma: { pushSubscription, settings, assessmentAttempt } };
});

import { GET } from "./route";
import { prisma } from "@/src/lib/prisma";

const pushSubscription = prisma.pushSubscription as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
};
const settings = prisma.settings as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};
const assessmentAttempt = prisma.assessmentAttempt as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
};

function makeReq(headers: Record<string, string> = { "x-cron-secret": "s3cret" }) {
  return new Request("https://example.test/api/push/send", { headers });
}

const ORIGINAL = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  pushSubscription.findFirst.mockReset();
  pushSubscription.findMany.mockReset();
  pushSubscription.deleteMany.mockReset();
  settings.findUnique.mockReset();
  settings.upsert.mockReset();
  assessmentAttempt.findFirst.mockReset();
  sendNotification.mockReset();
  sendNotification.mockResolvedValue(undefined);
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
  delete process.env.VAPID_SUBJECT;
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe("GET /api/push/send — auth", () => {
  it("returns 401 when CRON_SECRET is set but the header is missing", async () => {
    const res = await GET(makeReq({}));
    expect(res.status).toBe(401);
  });

  it("returns 500 when VAPID is not configured", async () => {
    delete process.env.VAPID_SUBJECT;
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
  });
});

describe("GET /api/push/send — gating", () => {
  it("skips when there is no subscription", async () => {
    pushSubscription.findFirst.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: "no_subscription" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("skips when the student already studied today (WIB)", async () => {
    pushSubscription.findFirst.mockResolvedValue({ id: "s1" });
    assessmentAttempt.findFirst.mockResolvedValue({ id: "a1" });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: "studied_today" });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("GET /api/push/send — delivery", () => {
  beforeEach(() => {
    pushSubscription.findFirst.mockResolvedValue({ id: "s1" });
    assessmentAttempt.findFirst.mockResolvedValue(null);
    settings.findUnique.mockResolvedValue({
      studentName: "Budi",
      lastNotificationCopyId: "soso.push.1",
    });
  });

  it("sends to every subscription and rotates the copy id", async () => {
    pushSubscription.findMany.mockResolvedValue([
      { id: "s1", endpoint: "https://push.example/good", p256dh: "p", auth: "a" },
    ]);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; sent: number; stale: number };
    expect(json.ok).toBe(true);
    expect(json.sent).toBe(1);
    expect(json.stale).toBe(0);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    // The sent copy must differ from the previous one.
    const upsert = settings.upsert.mock.calls[0][0];
    expect(upsert.create?.lastNotificationCopyId ?? upsert.update?.lastNotificationCopyId).not.toBe(
      "soso.push.1",
    );
  });

  it("deletes a subscription that returns 404/410 and keeps the rest", async () => {
    pushSubscription.findMany.mockResolvedValue([
      { id: "bad", endpoint: "https://push.example/bad", p256dh: "p", auth: "a" },
      { id: "good", endpoint: "https://push.example/good", p256dh: "p", auth: "a" },
    ]);
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === "https://push.example/bad") {
        throw { statusCode: 410 };
      }
      return undefined;
    });
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; sent: number; stale: number };
    expect(json.sent).toBe(1);
    expect(json.stale).toBe(1);
    expect(pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["bad"] } } });
  });
});
