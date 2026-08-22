import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const course = { findUnique: vi.fn() };
  const topic = { findMany: vi.fn(), updateMany: vi.fn() };
  const rPSReconcile = { findUnique: vi.fn(), upsert: vi.fn() };
  const tx = vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
  return { prisma: { course, topic, rPSReconcile, $transaction: tx } };
});

import { GET, PUT } from "./route";
import { prisma } from "@/src/lib/prisma";

const course = prisma.course as unknown as { findUnique: ReturnType<typeof vi.fn> };
const topic = prisma.topic as unknown as { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
const rps = prisma.rPSReconcile as unknown as { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };

function reqFor(courseId: string, body?: unknown) {
  return {
    json: body ? async () => body : async () => ({}),
    headers: { get: () => null },
    nextUrl: { searchParams: new URL(`http://x/api/rps/${courseId}`) },
  } as never;
}

const TOPICS = [
  { id: "t1", title: "Pengantar", weekNumber: 1, orderSource: "custom" },
  { id: "t2", title: "Habitus", weekNumber: 2, orderSource: "custom" },
];

describe("RPS reconciliation", () => {
  beforeEach(() => {
    course.findUnique.mockReset();
    topic.findMany.mockReset();
    topic.updateMany.mockReset();
    rps.findUnique.mockReset();
    rps.upsert.mockReset();
  });

  it("GET 404 for an unknown course", async () => {
    course.findUnique.mockResolvedValue(null);
    const res = await GET(reqFor("nope"), { params: Promise.resolve({ courseId: "nope" }) } as never);
    expect(res.status).toBe(404);
  });

  it("PUT aligns matching topics to official_rps and marks the rest custom", async () => {
    course.findUnique.mockResolvedValue({ id: "c1", name: "Antropologi" });
    rps.findUnique.mockResolvedValue(null);
    topic.findMany.mockResolvedValue(TOPICS);
    topic.updateMany.mockResolvedValue({ count: 1 });

    const res = await PUT(reqFor("c1", { officialOrder: "Pengantar\nHabitus" }), {
      params: Promise.resolve({ courseId: "c1" }),
    } as never);
    expect(res.status).toBe(200);
    // Both titles matched → both set to official_rps.
    expect(topic.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ["t1", "t2"] } }, data: { orderSource: "official_rps" } }),
    );
  });
});
