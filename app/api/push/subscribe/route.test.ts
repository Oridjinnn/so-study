import { describe, expect, it, vi, beforeEach } from "vitest";
import { TEST_USER_ID, OTHER_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

vi.mock("@/src/lib/prisma", () => {
  const pushSubscription = { upsert: vi.fn(async () => ({})) };
  const settings = { upsert: vi.fn(async () => ({})) };
  return { prisma: { pushSubscription, settings } };
});

import { POST } from "./route";
import { prisma } from "@/src/lib/prisma";

const pushSubscription = prisma.pushSubscription as unknown as {
  upsert: ReturnType<typeof vi.fn>;
};
const settings = prisma.settings as unknown as { upsert: ReturnType<typeof vi.fn> };

async function makeReq(body: unknown, userId?: string) {
  return { json: async () => body, headers: await authedHeaders(userId) } as never;
}

function anonReq(body: unknown) {
  return { json: async () => body, headers: anonymousHeaders() } as never;
}

const SUB = {
  endpoint: "https://push.example/abc",
  keys: { p256dh: "p256", auth: "auth" },
};

describe("POST /api/push/subscribe", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    pushSubscription.upsert.mockResolvedValue({});
    settings.upsert.mockResolvedValue({});
  });

  it("persists a valid subscription against the logged-in user", async () => {
    const res = await POST(await makeReq({ ...SUB, studentName: "Budi" }));
    expect(res.status).toBe(200);
    expect(pushSubscription.upsert).toHaveBeenCalledTimes(1);
    const call = pushSubscription.upsert.mock.calls[0][0];
    // The endpoint stays the upsert key (unique per browser push context)...
    expect(call.where).toEqual({ endpoint: "https://push.example/abc" });
    // ...but the row now records WHOSE device it is.
    expect(call.create).toMatchObject({ userId: TEST_USER_ID, p256dh: "p256", auth: "auth" });
    // The name lands in THIS user's settings row, keyed by userId (the old
    // `id: "singleton"` row no longer exists).
    expect(settings.upsert).toHaveBeenCalledTimes(1);
    expect(settings.upsert.mock.calls[0][0].where).toEqual({ userId: TEST_USER_ID });
    expect(settings.upsert.mock.calls[0][0].create).toMatchObject({
      userId: TEST_USER_ID,
      studentName: "Budi",
    });
  });

  it("401s a request with no session cookie and stores nothing", async () => {
    const res = await POST(anonReq(SUB));
    expect(res.status).toBe(401);
    expect(pushSubscription.upsert).not.toHaveBeenCalled();
    expect(settings.upsert).not.toHaveBeenCalled();
  });

  it("re-points a shared device at whoever is logged in now", async () => {
    // Same endpoint, other student: the update must move `userId`, otherwise the
    // iPad keeps receiving the previous person's nudges.
    await POST(await makeReq(SUB, OTHER_USER_ID));
    expect(pushSubscription.upsert.mock.calls[0][0].update).toMatchObject({
      userId: OTHER_USER_ID,
    });
    expect(settings.upsert.mock.calls[0][0].where).toEqual({ userId: OTHER_USER_ID });
  });

  it("rejects a subscription missing the keys", async () => {
    const res = await POST(await makeReq({ endpoint: "https://push.example/abc" }));
    expect(res.status).toBe(400);
    expect(pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid (non-URL) endpoint", async () => {
    const res = await POST(await makeReq({ endpoint: "not-a-url", keys: { p256dh: "p", auth: "a" } }));
    expect(res.status).toBe(400);
    expect(pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body", async () => {
    const res = await POST({
      json: async () => {
        throw new Error("bad");
      },
      headers: await authedHeaders(),
    } as never);
    expect(res.status).toBe(400);
    expect(pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it("does not overwrite the stored name when none is provided", async () => {
    const res = await POST(await makeReq({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } }));
    expect(res.status).toBe(200);
    expect(settings.upsert.mock.calls[0][0].create.studentName).toBeUndefined();
    expect(settings.upsert.mock.calls[0][0].create.userId).toBe(TEST_USER_ID);
    expect(settings.upsert.mock.calls[0][0].update).toEqual({});
  });
});
