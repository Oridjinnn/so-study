import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const topic = { findFirst: vi.fn(), delete: vi.fn() };
  return { prisma: { topic } };
});

import { DELETE } from "./route";
import { prisma } from "@/src/lib/prisma";
import {
  TEST_USER_ID,
  OTHER_USER_ID,
  authedHeaders,
  anonymousHeaders,
} from "@/src/lib/testAuth";

const topic = prisma.topic as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function req(headers: { get: (name: string) => string | null }) {
  return { headers } as never;
}

describe("DELETE /api/topics/[id]", () => {
  beforeEach(() => {
    topic.findFirst.mockReset();
    topic.delete.mockReset();
  });

  it("401s with no session", async () => {
    const res = await DELETE(req(await anonymousHeaders()), {
      params: Promise.resolve({ id: "t1" }),
    } as never);
    expect(res.status).toBe(401);
    expect(topic.delete).not.toHaveBeenCalled();
  });

  it("deletes the caller's own topic-only row", async () => {
    topic.findFirst.mockResolvedValue({ id: "t1", ownerId: TEST_USER_ID, module: null });
    const res = await DELETE(req(await authedHeaders()), {
      params: Promise.resolve({ id: "t1" }),
    } as never);
    expect(res.status).toBe(200);
    expect(topic.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
    // The read was owner-scoped, so it can only ever return my row.
    expect(topic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1", ownerId: TEST_USER_ID } }),
    );
  });

  it("409s when the caller's topic already owns a module (fail fast)", async () => {
    topic.findFirst.mockResolvedValue({
      id: "t1",
      ownerId: TEST_USER_ID,
      module: { id: "m1" },
    });
    const res = await DELETE(req(await authedHeaders()), {
      params: Promise.resolve({ id: "t1" }),
    } as never);
    expect(res.status).toBe(409);
    expect(topic.delete).not.toHaveBeenCalled();
  });

  it("404s (and never deletes) a topic that belongs to another student", async () => {
    // Owner-scoped findFirst simply does not return the other student's row.
    topic.findFirst.mockResolvedValue(null);
    const res = await DELETE(req(await authedHeaders(OTHER_USER_ID)), {
      params: Promise.resolve({ id: "t-theirs" }),
    } as never);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Topik tidak ditemukan." });
    expect(topic.delete).not.toHaveBeenCalled();
  });

  it("404s for a genuinely missing id as well — same answer, no leak", async () => {
    topic.findFirst.mockResolvedValue(null);
    const res = await DELETE(req(await authedHeaders()), {
      params: Promise.resolve({ id: "ghost" }),
    } as never);
    expect(res.status).toBe(404);
    expect(topic.delete).not.toHaveBeenCalled();
  });
});
