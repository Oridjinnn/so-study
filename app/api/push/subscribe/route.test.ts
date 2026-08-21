import { describe, expect, it, vi, beforeEach } from "vitest";

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

function makeReq(body: unknown) {
  return { json: async () => body } as never;
}

describe("POST /api/push/subscribe", () => {
  beforeEach(() => {
    pushSubscription.upsert.mockReset();
    settings.upsert.mockReset();
    pushSubscription.upsert.mockResolvedValue({});
    settings.upsert.mockResolvedValue({});
  });

  it("persists a valid subscription and the student name", async () => {
    const res = await POST(
      makeReq({
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p256", auth: "auth" },
        studentName: "Budi",
      }),
    );
    expect(res.status).toBe(200);
    expect(pushSubscription.upsert).toHaveBeenCalledTimes(1);
    const call = pushSubscription.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ endpoint: "https://push.example/abc" });
    expect(call.create).toMatchObject({ p256dh: "p256", auth: "auth" });
    expect(settings.upsert).toHaveBeenCalledTimes(1);
    expect(settings.upsert.mock.calls[0][0].create).toMatchObject({
      id: "singleton",
      studentName: "Budi",
    });
  });

  it("rejects a subscription missing the keys", async () => {
    const res = await POST(makeReq({ endpoint: "https://push.example/abc" }));
    expect(res.status).toBe(400);
    expect(pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid (non-URL) endpoint", async () => {
    const res = await POST(
      makeReq({ endpoint: "not-a-url", keys: { p256dh: "p", auth: "a" } }),
    );
    expect(res.status).toBe(400);
    expect(pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body", async () => {
    const res = await POST({ json: async () => { throw new Error("bad"); } } as never);
    expect(res.status).toBe(400);
    expect(pushSubscription.upsert).not.toHaveBeenCalled();
  });

  it("does not overwrite the stored name when none is provided", async () => {
    const res = await POST(
      makeReq({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } }),
    );
    expect(res.status).toBe(200);
    expect(settings.upsert.mock.calls[0][0].create.studentName).toBeUndefined();
    expect(settings.upsert.mock.calls[0][0].update).toEqual({});
  });
});
