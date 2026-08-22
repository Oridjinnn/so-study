import { describe, expect, it, vi, beforeEach } from "vitest";

// Tenancy for the two handlers that read and DELETE a whole study trail.
//
// The mocked `findFirst` is a tiny fake TABLE rather than a canned return value:
// it answers with the row only when the WHERE clause carries both the id AND the
// right owner. That is the only way a test can prove the route actually scopes
// its query — a stubbed `mockResolvedValue(null)` would pass just as happily for
// a route that forgot `ownerId` entirely.
vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    module: { findFirst: vi.fn() },
    topic: { deleteMany: vi.fn() },
    paper: { findMany: vi.fn() },
  },
}));

import { DELETE, GET } from "./route";
import { prisma } from "@/src/lib/prisma";
import { OTHER_USER_ID, TEST_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

const moduleMock = prisma.module as unknown as { findFirst: ReturnType<typeof vi.fn> };
const topicMock = prisma.topic as unknown as { deleteMany: ReturnType<typeof vi.fn> };
const paperMock = prisma.paper as unknown as { findMany: ReturnType<typeof vi.fn> };

/** The one module in the fake database. It belongs to TEST_USER_ID. */
const MODULE_ROW = {
  id: "m1",
  ownerId: TEST_USER_ID,
  topicId: "t1",
  topic: { title: "Teori Praktik Bourdieu" },
  contentMarkdown: "Habitus adalah disposisi [1].",
  generatedAt: new Date("2026-08-18T06:00:00.000Z"),
  wordCount: 5200,
  pageCount: 11,
  essayPrompt: null,
  essayRubric: null,
  sourcePaperIds: JSON.stringify(["p1"]),
  verifyReport: null,
  criticReport: null,
  verifiedAt: null,
  repairAttempts: 0,
  versions: [{ id: "v1", version: 1, generatedAt: new Date(), changeNote: "initial synthesis" }],
  courses: [{ course: { id: "c1", name: "Antropologi" } }],
};

function req(headers: { get: (name: string) => string | null }): Request {
  return { headers } as unknown as Request;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  // The fake table: the row is visible only to its owner.
  moduleMock.findFirst.mockImplementation(
    async ({ where }: { where: { id: string; ownerId: string } }) =>
      where.id === MODULE_ROW.id && where.ownerId === MODULE_ROW.ownerId ? MODULE_ROW : null,
  );
  paperMock.findMany.mockResolvedValue([
    { id: "p1", title: "Outline of a Theory of Practice", authors: "Bourdieu, P.", year: 1977 },
  ]);
  topicMock.deleteMany.mockResolvedValue({ count: 1 });
});

describe("GET /api/modules/[id]", () => {
  it("401s a request with no session, without touching the database", async () => {
    const res = await GET(req(anonymousHeaders()), ctx("m1"));
    expect(res.status).toBe(401);
    // An unauthenticated caller must not cost a query — the 401 is decided from
    // the cookie alone.
    expect(moduleMock.findFirst).not.toHaveBeenCalled();
  });

  it("returns the module to its owner, scoped by ownerId", async () => {
    const res = await GET(req(await authedHeaders()), ctx("m1"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; topicTitle: string };
    expect(json.id).toBe("m1");
    expect(json.topicTitle).toBe("Teori Praktik Bourdieu");
    expect(moduleMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1", ownerId: TEST_USER_ID } }),
    );
  });

  it("404s another student's module id — never 403, never its content", async () => {
    const res = await GET(req(await authedHeaders(OTHER_USER_ID)), ctx("m1"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Modul tidak ditemukan." });
    // The lookup really was filtered by the intruder's own id...
    expect(moduleMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1", ownerId: OTHER_USER_ID } }),
    );
    // ...and nothing about the module (not even its source papers) was read.
    expect(paperMock.findMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/modules/[id]", () => {
  it("401s a request with no session and deletes nothing", async () => {
    const res = await DELETE(req(anonymousHeaders()), ctx("m1"));
    expect(res.status).toBe(401);
    expect(moduleMock.findFirst).not.toHaveBeenCalled();
    expect(topicMock.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes the owner's topic with the owner folded into the delete itself", async () => {
    const res = await DELETE(req(await authedHeaders()), ctx("m1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(topicMock.deleteMany).toHaveBeenCalledWith({
      where: { id: "t1", ownerId: TEST_USER_ID },
    });
  });

  it("404s another student's module id AND mutates nothing", async () => {
    const res = await DELETE(req(await authedHeaders(OTHER_USER_ID)), ctx("m1"));
    expect(res.status).toBe(404);
    // The whole point: a guessed id cannot destroy someone else's study trail.
    expect(topicMock.deleteMany).not.toHaveBeenCalled();
  });
});
