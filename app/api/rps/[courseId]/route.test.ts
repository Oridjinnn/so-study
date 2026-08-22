import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const course = { findFirst: vi.fn() };
  const topic = { findMany: vi.fn(), updateMany: vi.fn() };
  const rPSReconcile = { findUnique: vi.fn(), upsert: vi.fn() };
  const tx = vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
  return { prisma: { course, topic, rPSReconcile, $transaction: tx } };
});

import { GET, PUT } from "./route";
import { prisma } from "@/src/lib/prisma";
import {
  TEST_USER_ID,
  OTHER_USER_ID,
  authedHeaders,
  anonymousHeaders,
} from "@/src/lib/testAuth";

const course = prisma.course as unknown as { findFirst: ReturnType<typeof vi.fn> };
const topic = prisma.topic as unknown as { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
const rps = prisma.rPSReconcile as unknown as { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };

function reqFor(courseId: string, body?: unknown, headers?: { get: (name: string) => string | null }) {
  return {
    json: body ? async () => body : async () => ({}),
    headers: headers ?? { get: () => null },
    nextUrl: { searchParams: new URL(`http://x/api/rps/${courseId}`) },
  } as never;
}

const TOPICS = [
  { id: "t1", title: "Pengantar", weekNumber: 1, orderSource: "custom" },
  { id: "t2", title: "Habitus", weekNumber: 2, orderSource: "custom" },
];

describe("RPS reconciliation", () => {
  beforeEach(() => {
    course.findFirst.mockReset();
    topic.findMany.mockReset();
    topic.updateMany.mockReset();
    rps.findUnique.mockReset();
    rps.upsert.mockReset();
  });

  it("401s with no session", async () => {
    const res = await GET(reqFor("c1", undefined, await anonymousHeaders()), {
      params: Promise.resolve({ courseId: "c1" }),
    } as never);
    expect(res.status).toBe(401);
  });

  it("GET 404 for a course that is not the caller's (own or other)", async () => {
    course.findFirst.mockResolvedValue(null);
    const res = await GET(reqFor("nope", undefined, await authedHeaders()), {
      params: Promise.resolve({ courseId: "nope" }),
    } as never);
    expect(res.status).toBe(404);
    // The owner is folded into the read, so a missing/foreign course is one null.
    expect(course.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "nope", ownerId: TEST_USER_ID } }),
    );
  });

  it("reads only the caller's topics", async () => {
    course.findFirst.mockResolvedValue({ id: "c1", name: "Antropologi" });
    topic.findMany.mockResolvedValue(TOPICS);
    rps.findUnique.mockResolvedValue(null);
    await GET(reqFor("c1", undefined, await authedHeaders()), {
      params: Promise.resolve({ courseId: "c1" }),
    } as never);
    expect(topic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: "c1", ownerId: TEST_USER_ID } }),
    );
  });

  it("PUT aligns matching topics to official_rps and marks the rest custom", async () => {
    course.findFirst.mockResolvedValue({ id: "c1", name: "Antropologi" });
    rps.findUnique.mockResolvedValue(null);
    topic.findMany.mockResolvedValue(TOPICS);
    topic.updateMany.mockResolvedValue({ count: 1 });

    const res = await PUT(reqFor("c1", { officialOrder: "Pengantar\nHabitus" }, await authedHeaders()), {
      params: Promise.resolve({ courseId: "c1" }),
    } as never);
    expect(res.status).toBe(200);
    // Both titles matched → both set to official_rps, scoped by ownerId.
    expect(topic.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["t1", "t2"] }, ownerId: TEST_USER_ID }, data: { orderSource: "official_rps" } }),
    );
  });

  it("PUT 404s for another student's course and writes nothing", async () => {
    course.findFirst.mockResolvedValue(null); // not the caller's course
    const res = await PUT(reqFor("c-theirs", { officialOrder: "X" }, await authedHeaders(OTHER_USER_ID)), {
      params: Promise.resolve({ courseId: "c-theirs" }),
    } as never);
    expect(res.status).toBe(404);
    expect(rps.upsert).not.toHaveBeenCalled();
    expect(topic.updateMany).not.toHaveBeenCalled();
  });
});
