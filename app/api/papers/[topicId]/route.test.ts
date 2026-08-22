import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const topicPaper = { findMany: vi.fn(), update: vi.fn() };
  const topic = { findFirst: vi.fn(), update: vi.fn() };
  return { prisma: { topicPaper, topic } };
});

import { GET, PATCH } from "./route";
import { prisma } from "@/src/lib/prisma";
import {
  TEST_USER_ID,
  OTHER_USER_ID,
  authedHeaders,
  anonymousHeaders,
} from "@/src/lib/testAuth";

const topicPaper = prisma.topicPaper as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
const topic = prisma.topic as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function reqFor(topicId: string, body?: unknown, headers?: { get: (name: string) => string | null }) {
  return {
    json: body ? async () => body : async () => ({}),
    headers: headers ?? { get: () => null },
    nextUrl: { searchParams: new URL(`http://x/api/papers/${topicId}`) },
  } as never;
}

const PAPER_ROWS = [
  {
    paperId: "p1",
    paper: {
      id: "p1",
      title: "A",
      authors: null,
      year: 2020,
      abstract: null,
      citationCount: 1,
      relevanceScore: 0.9,
      sourceUrl: "u1",
      fullTextAvailable: false,
      doi: null,
    },
    approved: false,
  },
];

describe("GET /api/papers/[topicId]", () => {
  beforeEach(() => {
    topicPaper.findMany.mockReset();
    topicPaper.update.mockReset();
    topic.findFirst.mockReset();
    topic.update.mockReset();
  });

  it("401s with no session", async () => {
    const res = await GET(reqFor("t1", undefined, await anonymousHeaders()), {
      params: Promise.resolve({ topicId: "t1" }),
    } as never);
    expect(res.status).toBe(401);
  });

  it("scopes the TopicPaper join to the caller's topic", async () => {
    topicPaper.findMany.mockResolvedValue(PAPER_ROWS);
    const res = await GET(reqFor("t1", undefined, await authedHeaders()), {
      params: Promise.resolve({ topicId: "t1" }),
    } as never);
    expect(res.status).toBe(200);
    expect(topicPaper.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { topicId: "t1", topic: { ownerId: TEST_USER_ID } } }),
    );
    const body = await res.json();
    expect(body.papers).toHaveLength(1);
  });

  it("returns an empty list (never a 403) for another student's topic", async () => {
    // The owner-scoped join returns nothing for a topic that is not mine.
    topicPaper.findMany.mockResolvedValue([]);
    const res = await GET(reqFor("t-theirs", undefined, await authedHeaders(OTHER_USER_ID)), {
      params: Promise.resolve({ topicId: "t-theirs" }),
    } as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.papers).toEqual([]);
  });
});

describe("PATCH /api/papers/[topicId]", () => {
  beforeEach(() => {
    topicPaper.findMany.mockReset();
    topicPaper.update.mockReset();
    topic.findFirst.mockReset();
    topic.update.mockReset();
  });

  it("401s with no session", async () => {
    const res = await PATCH(reqFor("t1", { approvedPaperIds: ["p1"] }, await anonymousHeaders()), {
      params: Promise.resolve({ topicId: "t1" }),
    } as never);
    expect(res.status).toBe(401);
    expect(topicPaper.update).not.toHaveBeenCalled();
    expect(topic.update).not.toHaveBeenCalled();
  });

  it("flips approval for the caller's own topic", async () => {
    topic.findFirst.mockResolvedValue({ id: "t1" });
    topicPaper.findMany.mockResolvedValue(PAPER_ROWS);
    topicPaper.update.mockResolvedValue({});
    topic.update.mockResolvedValue({});
    const res = await PATCH(reqFor("t1", { approvedPaperIds: ["p1"] }, await authedHeaders()), {
      params: Promise.resolve({ topicId: "t1" }),
    } as never);
    expect(res.status).toBe(200);
    expect(topicPaper.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { topicId_paperId: { topicId: "t1", paperId: "p1" } }, data: { approved: true } }),
    );
    expect(topic.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1" }, data: { status: "papers_approved" } }),
    );
    // The read was owner-scoped, so this could only ever be my topic.
    expect(topic.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "t1", ownerId: TEST_USER_ID } }),
    );
  });

  it("404s and writes nothing for another student's topic", async () => {
    // The owner check resolves to null for a topic that is not mine.
    topic.findFirst.mockResolvedValue(null);
    const res = await PATCH(reqFor("t-theirs", { approvedPaperIds: ["p1"] }, await authedHeaders(OTHER_USER_ID)), {
      params: Promise.resolve({ topicId: "t-theirs" }),
    } as never);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Topik tidak ditemukan." });
    expect(topicPaper.findMany).not.toHaveBeenCalled();
    expect(topicPaper.update).not.toHaveBeenCalled();
    expect(topic.update).not.toHaveBeenCalled();
  });
});
