import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("web-push", () => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock("@/src/lib/prisma", () => {
  const pushSubscription = { findMany: vi.fn(), deleteMany: vi.fn() };
  const assessmentAttempt = { findFirst: vi.fn() };
  const settings = { findUnique: vi.fn(), upsert: vi.fn() };
  return { prisma: { pushSubscription, assessmentAttempt, settings } };
});
// Deterministic copy so "did A receive B's message?" is a assertable string
// rather than a 1-in-4 coin flip. The real bank is covered by app/lib/soso.test.ts.
vi.mock("@/app/lib/soso", () => ({
  pickPushCopy: (studentName?: string | null, lastCopyId?: string | null) => ({
    copyId: `copy-for-${studentName ?? "anon"}`,
    title: "Soso",
    body: `Hai ${studentName ?? "kamu"}, belum belajar hari ini! (setelah ${lastCopyId ?? "-"})`,
  }),
}));

import { GET } from "./route";
import { prisma } from "@/src/lib/prisma";
import * as webpush from "web-push";

const pushSubscription = prisma.pushSubscription as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
};
const assessmentAttempt = prisma.assessmentAttempt as unknown as { findFirst: ReturnType<typeof vi.fn> };
const settings = prisma.settings as unknown as { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
const send = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;

const savedEnv = { ...process.env };

const ME = "user-me";
const HER = "user-her";

/** Devices per user. "Never send her copy to my iPad" is exactly this mapping. */
const DEVICES: Record<string, { id: string; endpoint: string; p256dh: string; auth: string }[]> = {
  [ME]: [{ id: "s-me", endpoint: "e-me", p256dh: "p1", auth: "a1" }],
  [HER]: [{ id: "s-her", endpoint: "e-her", p256dh: "p2", auth: "a2" }],
};

/** Wire the subscription table: a distinct-user query, then a per-user query. */
function wireSubscriptions(userIds: string[], devices = DEVICES) {
  pushSubscription.findMany.mockImplementation(
    async (args: { distinct?: string[]; where?: { userId: string } }) => {
      if (args?.distinct) return userIds.map((userId) => ({ userId }));
      return devices[args?.where?.userId ?? ""] ?? [];
    },
  );
}

/** Which users have an attempt in the Jakarta day. */
function wireStudiedToday(studied: string[]) {
  assessmentAttempt.findFirst.mockImplementation(
    async (args: { where: { topic: { ownerId: string } } }) =>
      studied.includes(args.where.topic.ownerId) ? { id: "a1" } : null,
  );
}

function wireNames(names: Record<string, string>) {
  settings.findUnique.mockImplementation(async (args: { where: { userId: string } }) => {
    const studentName = names[args.where.userId];
    return studentName ? { userId: args.where.userId, studentName, lastNotificationCopyId: null } : null;
  });
}

function req() {
  return new Request("http://x/api/push/send");
}

/** The payload delivered to one endpoint, or undefined if it got nothing. */
function payloadFor(endpoint: string): string | undefined {
  const call = send.mock.calls.find((c) => (c[0] as { endpoint: string }).endpoint === endpoint);
  return call ? (call[1] as string) : undefined;
}

describe("GET /api/push/send (real web-push, per user)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.CRON_SECRET;
    process.env.VAPID_SUBJECT = "mailto:me@example.com";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    settings.findUnique.mockResolvedValue(null);
    settings.upsert.mockResolvedValue({});
    pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
    send.mockResolvedValue(undefined as never);
  });
  afterEach(() => {
    for (const k of ["CRON_SECRET", "VAPID_SUBJECT", "NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"]) {
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
      else delete process.env[k];
    }
  });

  // ---- the cron guard (this route is deliberately exempt from requireUser) ---

  it("401 when CRON_SECRET is set but no header is provided", async () => {
    process.env.CRON_SECRET = "topsecret";
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("500 when VAPID keys are not configured", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    wireSubscriptions([ME]);
    const res = await GET(req());
    expect(res.status).toBe(500);
  });

  it("skips when there is no subscription at all (nothing to send)", async () => {
    wireSubscriptions([]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; skipped?: string; sent: number; stale: number };
    expect(body.skipped).toBe("no_subscription");
    expect(body).toMatchObject({ ok: true, sent: 0, stale: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  // ---- per-user correctness (the reason this route was reworked) -------------

  it("A studying does NOT suppress B's reminder, and A gets nothing", async () => {
    wireSubscriptions([ME, HER]);
    wireStudiedToday([ME]); // I practised today; she did not
    wireNames({ [ME]: "Habel", [HER]: "Ayu" });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      sent: number;
      stale: number;
      users: { userId: string; sent: number; skipped?: string }[];
    };

    // She is nudged even though I studied — the old global query silenced her.
    expect(body.sent).toBe(1);
    expect(payloadFor("e-her")).toContain("Ayu");
    // ...and my device receives nothing, because I did study.
    expect(payloadFor("e-me")).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    expect(body.users).toEqual([
      { userId: ME, sent: 0, stale: 0, skipped: "studied_today" },
      { userId: HER, sent: 1, stale: 0 },
    ]);
  });

  it("never delivers one student's copy to the other's device", async () => {
    wireSubscriptions([ME, HER]);
    wireStudiedToday([]); // neither studied: both get a nudge
    wireNames({ [ME]: "Habel", [HER]: "Ayu" });

    await GET(req());

    // Each payload is addressed to its own owner. The bug being prevented is
    // literally "her name, my iPad".
    expect(payloadFor("e-me")).toContain("Habel");
    expect(payloadFor("e-me")).not.toContain("Ayu");
    expect(payloadFor("e-her")).toContain("Ayu");
    expect(payloadFor("e-her")).not.toContain("Habel");
  });

  it("checks each user's OWN attempts, scoped through the topic relation", async () => {
    wireSubscriptions([ME, HER]);
    wireStudiedToday([]);
    await GET(req());
    for (const userId of [ME, HER]) {
      expect(assessmentAttempt.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ topic: { ownerId: userId } }),
        }),
      );
    }
  });

  it("reads and rotates each user's own Settings row (no singleton)", async () => {
    wireSubscriptions([ME, HER]);
    wireStudiedToday([]);
    wireNames({ [HER]: "Ayu" });
    await GET(req());

    expect(settings.findUnique).toHaveBeenCalledWith({ where: { userId: ME } });
    expect(settings.findUnique).toHaveBeenCalledWith({ where: { userId: HER } });
    // Copy rotation is recorded per user, so my send cannot advance her cursor.
    const upsertTargets = settings.upsert.mock.calls.map((c) => c[0].where);
    expect(upsertTargets).toEqual([{ userId: ME }, { userId: HER }]);
    expect(settings.upsert.mock.calls[1][0].update).toEqual({
      lastNotificationCopyId: "copy-for-Ayu",
    });
  });

  it("only queries the subscriptions of the user being notified", async () => {
    wireSubscriptions([ME, HER]);
    wireStudiedToday([ME]);
    await GET(req());
    // I studied, so my devices are never even listed.
    const whereCalls = pushSubscription.findMany.mock.calls
      .map((c) => c[0]?.where?.userId)
      .filter(Boolean);
    expect(whereCalls).toEqual([HER]);
  });

  it("reports skipped: studied_today at the top level when nobody needs a nudge", async () => {
    wireSubscriptions([ME, HER]);
    wireStudiedToday([ME, HER]);
    const res = await GET(req());
    const body = (await res.json()) as { ok: boolean; sent: number; stale: number; skipped?: string };
    // Backward-compatible with the old single-user response shape.
    expect(body).toMatchObject({ ok: true, sent: 0, stale: 0, skipped: "studied_today" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends to subscribers and drops stale (404/410) subscriptions", async () => {
    wireSubscriptions([ME], {
      [ME]: [
        { id: "s1", endpoint: "e1", p256dh: "p1", auth: "a1" },
        { id: "s2", endpoint: "e2", p256dh: "p2", auth: "a2" },
      ],
    });
    wireStudiedToday([]);
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

  it("one user's failure does not swallow the other user's reminder", async () => {
    wireSubscriptions([ME, HER]);
    assessmentAttempt.findFirst.mockImplementation(async (args: { where: { topic: { ownerId: string } } }) => {
      if (args.where.topic.ownerId === ME) throw new Error("db hiccup");
      return null;
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: number; users: { userId: string; skipped?: string }[] };
    expect(body.sent).toBe(1);
    expect(payloadFor("e-her")).toBeTruthy();
    expect(body.users[0]).toMatchObject({ userId: ME, skipped: "error" });
  });
});
