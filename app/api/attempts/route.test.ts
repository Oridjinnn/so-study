import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const assessmentAttempt = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  };
  return { prisma: { assessmentAttempt } };
});

import { POST, GET } from "./route";
import { prisma } from "@/src/lib/prisma";

const attempt = prisma.assessmentAttempt as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

function makeReq(body: unknown) {
  return { json: async () => body } as never;
}

function reqWithSearch(url: string) {
  return { url } as never;
}

describe("POST /api/attempts", () => {
  beforeEach(() => {
    attempt.findFirst.mockReset();
    attempt.findMany.mockReset();
    attempt.create.mockReset();
    // No previous review → fresh FSRS state from the outcome.
    attempt.findFirst.mockResolvedValue(null);
    attempt.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: "att-1",
      answeredAt: new Date(),
      scheduledNextAt: new Date(Date.now() + 86_400_000),
      ...args.data,
    }));
  });

  it("rejects a missing moduleId/topicId/items with 400", async () => {
    const res = await POST(makeReq({ moduleId: "m1", items: [] }));
    expect(res.status).toBe(400);
  });

  it("writes an attempt and returns a scheduled next review (SRS fed)", async () => {
    const res = await POST(
      makeReq({
        moduleId: "m1",
        topicId: "t1",
        items: [{ questionType: "mcq", itemRef: "q1", prompt: "Apa itu habitus?", isCorrect: true, confidence: 4 }],
      }),
    );
    expect(res.status).toBe(200);
    expect(attempt.create).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { attempts: { scheduledNextAt: string }[] };
    expect(body.attempts).toHaveLength(1);
    // A correct, confident recall must schedule a FUTURE review, not ignore it.
    expect(new Date(body.attempts[0].scheduledNextAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("GET /api/attempts", () => {
  it("returns 200 and filters to due items when due=1", async () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    attempt.findMany.mockResolvedValue([
      { id: "a1", scheduledNextAt: past, isCorrect: true, answeredAt: past },
      { id: "a2", scheduledNextAt: future, isCorrect: true, answeredAt: future },
    ]);
    const res = await GET(reqWithSearch("http://x/api/attempts?due=1&moduleId=m1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attempts: { id: string }[] };
    expect(body.attempts.map((a) => a.id)).toEqual(["a1"]);
  });
});
