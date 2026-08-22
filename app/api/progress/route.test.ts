import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const topic = { findMany: vi.fn() };
  return { prisma: { topic } };
});

import { GET } from "./route";
import { prisma } from "@/src/lib/prisma";

const topic = prisma.topic as unknown as { findMany: ReturnType<typeof vi.fn> };

function reqFor(courseId: string) {
  return { nextUrl: new URL(`http://x/api/progress?courseId=${courseId}`) } as never;
}

const now = new Date();

describe("GET /api/progress", () => {
  beforeEach(() => topic.findMany.mockReset());

  it("rejects a missing courseId with 400", async () => {
    const res = await GET({ nextUrl: new URL("http://x/api/progress") } as never);
    expect(res.status).toBe(400);
  });

  it("computes due-today, mastery and streak from attempts", async () => {
    const courseTopics = [
      {
        id: "t1",
        title: "Habitus",
        status: "ready",
        dueBeforeLecture: null,
        module: { id: "m1" },
        attempts: [
          { isCorrect: true, answeredAt: now, scheduledNextAt: new Date(now.getTime() + 86_400_000) },
          { isCorrect: false, answeredAt: now, scheduledNextAt: new Date(now.getTime() + 86_400_000) },
        ],
      },
    ];
    const allTopics = [{ courseId: "c1", dueBeforeLecture: null }];
    // First call: course topics (include module+attempts). Second call: all topics.
    topic.findMany.mockResolvedValueOnce(courseTopics).mockResolvedValueOnce(allTopics);

    const res = await GET(reqFor("c1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { topics: { masteryPct: number }[]; avgMastery: number; streakDays: number };
    // 1 of 2 scored attempts correct → 50% mastery.
    expect(body.topics[0].masteryPct).toBe(50);
    expect(body.avgMastery).toBe(50);
    // One attempt today → streak at least 1.
    expect(body.streakDays).toBeGreaterThanOrEqual(1);
  });
});
