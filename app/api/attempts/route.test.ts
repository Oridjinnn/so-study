import { describe, expect, it, vi, beforeEach } from "vitest";
import { TEST_USER_ID, OTHER_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

// The tenancy assertions here read the WHERE clauses, because that is where
// ownership actually lives: an attempt row has no ownerId of its own, so a query
// that forgets `topic: { ownerId }` silently returns (or writes into) another
// student's practice history. The session cookie is a REAL signed cookie so the
// same verification path as production runs.
vi.mock("@/src/lib/prisma", () => {
  const assessmentAttempt = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  };
  const topic = { findFirst: vi.fn() };
  // Named `moduleDelegate`, not `module`: a bare `module` binding trips the
  // Next.js lint rule about shadowing the CommonJS global.
  const moduleDelegate = { findFirst: vi.fn() };
  return { prisma: { assessmentAttempt, topic, module: moduleDelegate } };
});

import { POST, GET } from "./route";
import { prisma } from "@/src/lib/prisma";

const attempt = prisma.assessmentAttempt as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};
const topic = prisma.topic as unknown as { findFirst: ReturnType<typeof vi.fn> };
const mod = prisma.module as unknown as { findFirst: ReturnType<typeof vi.fn> };

async function makeReq(body: unknown, userId?: string) {
  return { json: async () => body, headers: await authedHeaders(userId) } as never;
}

function anonReq(body: unknown) {
  return { json: async () => body, headers: anonymousHeaders() } as never;
}

async function reqWithSearch(url: string, userId?: string) {
  return { url, headers: await authedHeaders(userId) } as never;
}

const ITEMS = [
  { questionType: "mcq", itemRef: "q1", prompt: "Apa itu habitus?", isCorrect: true, confidence: 4 },
];

describe("POST /api/attempts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // No previous review → fresh FSRS state from the outcome.
    attempt.findFirst.mockResolvedValue(null);
    topic.findFirst.mockResolvedValue({ id: "t1" });
    mod.findFirst.mockResolvedValue({ id: "m1" });
    attempt.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: "att-1",
      answeredAt: new Date(),
      scheduledNextAt: new Date(Date.now() + 86_400_000),
      ...args.data,
    }));
  });

  it("401s a request with no session cookie", async () => {
    const res = await POST(anonReq({ moduleId: "m1", topicId: "t1", items: ITEMS }));
    expect(res.status).toBe(401);
    // Nothing was even read, let alone written.
    expect(topic.findFirst).not.toHaveBeenCalled();
    expect(attempt.create).not.toHaveBeenCalled();
  });

  it("rejects a missing moduleId/topicId/items with 400", async () => {
    const res = await POST(await makeReq({ moduleId: "m1", items: [] }));
    expect(res.status).toBe(400);
  });

  it("writes an attempt and returns a scheduled next review (SRS fed)", async () => {
    const res = await POST(await makeReq({ moduleId: "m1", topicId: "t1", items: ITEMS }));
    expect(res.status).toBe(200);
    expect(attempt.create).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as { attempts: { scheduledNextAt: string }[] };
    expect(body.attempts).toHaveLength(1);
    // A correct, confident recall must schedule a FUTURE review, not ignore it.
    expect(new Date(body.attempts[0].scheduledNextAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("proves ownership of BOTH the topic and the module before writing", async () => {
    await POST(await makeReq({ moduleId: "m1", topicId: "t1", items: ITEMS }));
    expect(topic.findFirst).toHaveBeenCalledWith({
      where: { id: "t1", ownerId: TEST_USER_ID },
      select: { id: true },
    });
    expect(mod.findFirst).toHaveBeenCalledWith({
      where: { id: "m1", ownerId: TEST_USER_ID },
      select: { id: true },
    });
  });

  it("404s another student's topic id and writes NOTHING", async () => {
    // Her topic is invisible to this owner-scoped lookup.
    topic.findFirst.mockResolvedValue(null);
    const res = await POST(await makeReq({ moduleId: "m1", topicId: "her-topic", items: ITEMS }));
    expect(res.status).toBe(404);
    expect(attempt.create).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: "Topik tidak ditemukan." });
  });

  it("404s another student's module id and writes NOTHING", async () => {
    mod.findFirst.mockResolvedValue(null);
    const res = await POST(await makeReq({ moduleId: "her-module", topicId: "t1", items: ITEMS }));
    expect(res.status).toBe(404);
    expect(attempt.create).not.toHaveBeenCalled();
  });

  it("scopes the carried-forward SRS state to the caller", async () => {
    await POST(await makeReq({ moduleId: "m1", topicId: "t1", items: ITEMS }));
    expect(attempt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ topic: { ownerId: TEST_USER_ID } }),
      }),
    );
  });

  it("scopes by the SESSION user, not a caller-supplied id", async () => {
    await POST(await makeReq({ moduleId: "m1", topicId: "t1", items: ITEMS }, OTHER_USER_ID));
    expect(topic.findFirst).toHaveBeenCalledWith({
      where: { id: "t1", ownerId: OTHER_USER_ID },
      select: { id: true },
    });
  });
});

describe("GET /api/attempts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("401s a request with no session cookie", async () => {
    const res = await GET({ url: "http://x/api/attempts", headers: anonymousHeaders() } as never);
    expect(res.status).toBe(401);
    expect(attempt.findMany).not.toHaveBeenCalled();
  });

  it("returns 200 and filters to due items when due=1", async () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    attempt.findMany.mockResolvedValue([
      { id: "a1", scheduledNextAt: past, isCorrect: true, answeredAt: past },
      { id: "a2", scheduledNextAt: future, isCorrect: true, answeredAt: future },
    ]);
    const res = await GET(await reqWithSearch("http://x/api/attempts?due=1&moduleId=m1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attempts: { id: string }[] };
    expect(body.attempts.map((a) => a.id)).toEqual(["a1"]);
  });

  it("always scopes the listing through the topic owner", async () => {
    attempt.findMany.mockResolvedValue([]);
    await GET(await reqWithSearch("http://x/api/attempts?moduleId=m1&topicId=t1"));
    expect(attempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { topic: { ownerId: TEST_USER_ID }, moduleId: "m1", topicId: "t1" },
      }),
    );
  });

  it("returns an empty list — not a 404 — for another student's ids", async () => {
    // The owner filter makes her rows unreachable, so the query legitimately
    // finds nothing; the response must not confirm that her ids are real.
    attempt.findMany.mockResolvedValue([]);
    const res = await GET(await reqWithSearch("http://x/api/attempts?topicId=her-topic"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ attempts: [] });
  });
});
