import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const make = () => ({
    findMany: vi.fn(async () => []),
    upsert: vi.fn(async () => ({})),
  });
  const prisma = {
    paper: make(),
    course: make(),
    topic: make(),
    module: make(),
    courseModule: make(),
    moduleChunk: make(),
    excerpt: make(),
    moduleVersion: make(),
    qASession: make(),
    assessmentAttempt: make(),
    questionBankItem: make(),
    aIUsage: make(),
    rPSReconcile: make(),
    topicPaper: make(),
    $transaction: vi.fn(async (fn: (p: unknown) => unknown) => fn(prisma)),
  };
  return { prisma };
});

import { GET, POST } from "./route";
import { prisma } from "@/src/lib/prisma";

const tables = [
  "paper",
  "course",
  "topic",
  "module",
  "courseModule",
  "moduleChunk",
  "excerpt",
  "moduleVersion",
  "qASession",
  "assessmentAttempt",
  "questionBankItem",
  "aIUsage",
  "rPSReconcile",
  "topicPaper",
] as const;

function makeReq(body: unknown) {
  return { json: async () => body, headers: { get: () => null } } as never;
}

beforeEach(() => {
  for (const t of tables) {
    (prisma[t as (typeof tables)[number]] as unknown as { findMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }).findMany.mockReset();
    (prisma[t as (typeof tables)[number]] as unknown as { findMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> }).upsert.mockReset();
  }
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockReset();
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (p: unknown) => unknown) => fn(prisma));
});

describe("GET /api/backup", () => {
  it("returns a versioned snapshot with every data table present", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      exportedAt: string;
      version: number;
      data: Record<string, unknown>;
    };
    expect(json.version).toBe(1);
    expect(typeof json.exportedAt).toBe("string");
    // Every user-data table the route promises must be a present key.
    for (const key of [
      "courses",
      "topics",
      "papers",
      "topicPapers",
      "modules",
      "courseModules",
      "moduleChunks",
      "excerpts",
      "moduleVersions",
      "qaSessions",
      "assessmentAttempts",
      "questionBankItems",
      "aiUsage",
      "rpsReconciles",
    ]) {
      expect(json.data).toHaveProperty(key);
      expect(Array.isArray(json.data[key])).toBe(true);
    }
    // It queried the database for each table.
    expect((prisma as unknown as { course: { findMany: ReturnType<typeof vi.fn> } }).course.findMany).toHaveBeenCalled();
  });
});

describe("POST /api/backup", () => {
  it("rejects an import without confirm: overwite", async () => {
    const res = await POST(makeReq({ data: { courses: [{ id: "c1", name: "X" }] } }));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed payload", async () => {
    const res = await POST(makeReq({ confirm: "overwrite", data: 42 }));
    expect(res.status).toBe(400);
  });

  it("round-trips a small valid payload and reports counts", async () => {
    const payload = {
      confirm: "overwrite",
      data: {
        courses: [{ id: "c1", name: "Antropologi", major: null }],
        topics: [{ id: "t1", courseId: "c1", title: "Habitus", status: "ready" }],
        papers: [{ id: "p1", title: "Practice", sourceUrl: "https://x/1" }],
        topicPapers: [{ topicId: "t1", paperId: "p1", approved: true }],
        modules: [{ id: "m1", topicId: "t1", contentMarkdown: "# x", sourcePaperIds: "[]" }],
        assessmentAttempts: [
          { id: "a1", moduleId: "m1", topicId: "t1", questionType: "mcq", itemRef: "q1", prompt: "?" },
        ],
      },
    };
    const res = await POST(makeReq(payload));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; counts: Record<string, number> };
    expect(json.ok).toBe(true);
    expect(json.counts.courses).toBe(1);
    expect(json.counts.topics).toBe(1);
    expect(json.counts.papers).toBe(1);
    expect(json.counts.topicPapers).toBe(1);
    expect(json.counts.modules).toBe(1);
    expect(json.counts.assessmentAttempts).toBe(1);
    // Wrote within a single transaction.
    expect((prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction).toHaveBeenCalledTimes(1);
    const courseUpsert = (prisma as unknown as { course: { upsert: ReturnType<typeof vi.fn> } }).course.upsert;
    expect(courseUpsert).toHaveBeenCalledWith({ where: { id: "c1" }, create: expect.anything(), update: expect.anything() });
  });
});
