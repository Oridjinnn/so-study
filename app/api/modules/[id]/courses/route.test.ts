import { describe, expect, it, vi, beforeEach } from "vitest";

// Two ids per request (module in the path, course in the body) means two places
// to get tenancy wrong, so both are asserted here. The prisma mocks are fake
// TABLES keyed by owner rather than canned values: a route that dropped `ownerId`
// from either WHERE clause would still satisfy a plain `mockResolvedValue`.
vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    module: { findFirst: vi.fn() },
    course: { findFirst: vi.fn(), upsert: vi.fn() },
    courseModule: { upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { DELETE, POST } from "./route";
import { prisma } from "@/src/lib/prisma";
import { OTHER_USER_ID, TEST_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

const moduleMock = prisma.module as unknown as { findFirst: ReturnType<typeof vi.fn> };
const courseMock = prisma.course as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};
const linkMock = prisma.courseModule as unknown as {
  upsert: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
};

const MODULE_ROW = { id: "m1", ownerId: TEST_USER_ID };
/** "c-mine" is the caller's course; "c-hers" belongs to the other student. */
const COURSE_ROWS = [
  { id: "c-mine", ownerId: TEST_USER_ID, name: "Antropologi Ekologi" },
  { id: "c-hers", ownerId: OTHER_USER_ID, name: "Antropologi Ekologi" },
];

interface CourseWhere {
  id?: string;
  ownerId: string;
  name?: string;
}

function reqWith(
  headers: { get: (name: string) => string | null },
  body: unknown,
): Parameters<typeof POST>[0] {
  return { headers, json: async () => body } as unknown as Parameters<typeof POST>[0];
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  moduleMock.findFirst.mockImplementation(
    async ({ where }: { where: { id: string; ownerId: string } }) =>
      where.id === MODULE_ROW.id && where.ownerId === MODULE_ROW.ownerId ? MODULE_ROW : null,
  );
  courseMock.findFirst.mockImplementation(async ({ where }: { where: CourseWhere }) =>
    COURSE_ROWS.find(
      (c) =>
        c.ownerId === where.ownerId &&
        (where.id === undefined || c.id === where.id) &&
        (where.name === undefined || c.name === where.name),
    ) ?? null,
  );
  courseMock.upsert.mockResolvedValue({ id: "c-new", ownerId: TEST_USER_ID, name: "Sosiologi" });
  linkMock.upsert.mockResolvedValue({});
  linkMock.deleteMany.mockResolvedValue({ count: 1 });
  linkMock.findMany.mockResolvedValue([
    { course: { id: "c-mine", name: "Antropologi Ekologi" } },
  ]);
});

describe("POST /api/modules/[id]/courses", () => {
  it("401s with no session and writes no link", async () => {
    const res = await POST(reqWith(anonymousHeaders(), { courseId: "c-mine" }), ctx("m1"));
    expect(res.status).toBe(401);
    expect(moduleMock.findFirst).not.toHaveBeenCalled();
    expect(linkMock.upsert).not.toHaveBeenCalled();
  });

  it("links the caller's module to the caller's course", async () => {
    const res = await POST(
      reqWith(await authedHeaders(), { courseId: "c-mine" }),
      ctx("m1"),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      courses: [{ id: "c-mine", name: "Antropologi Ekologi" }],
    });
    expect(courseMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c-mine", ownerId: TEST_USER_ID } }),
    );
    expect(linkMock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId_moduleId: { courseId: "c-mine", moduleId: "m1" } },
      }),
    );
    // The echoed list is scoped through the join's parent course.
    expect(linkMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { moduleId: "m1", course: { ownerId: TEST_USER_ID } } }),
    );
  });

  it("404s a courseId that belongs to the other student, and links nothing", async () => {
    const res = await POST(reqWith(await authedHeaders(), { courseId: "c-hers" }), ctx("m1"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Matakuliah tidak ditemukan." });
    expect(linkMock.upsert).not.toHaveBeenCalled();
  });

  it("creates a course by name under the caller via the per-owner unique key", async () => {
    const res = await POST(
      reqWith(await authedHeaders(), { courseName: "  Sosiologi  " }),
      ctx("m1"),
    );
    expect(res.status).toBe(200);
    // Compound key, not `where: { name }`: the name is unique PER OWNER now, so
    // an identically-named course of the other student is never adopted.
    expect(courseMock.upsert).toHaveBeenCalledWith({
      where: { ownerId_name: { ownerId: TEST_USER_ID, name: "Sosiologi" } },
      update: {},
      create: { ownerId: TEST_USER_ID, name: "Sosiologi" },
    });
  });

  it("404s another student's module id and never reaches the course resolution", async () => {
    const res = await POST(
      reqWith(await authedHeaders(OTHER_USER_ID), { courseId: "c-hers" }),
      ctx("m1"),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Modul tidak ditemukan." });
    expect(courseMock.findFirst).not.toHaveBeenCalled();
    expect(linkMock.upsert).not.toHaveBeenCalled();
  });

  it("still requires one of courseId / courseName", async () => {
    const res = await POST(reqWith(await authedHeaders(), {}), ctx("m1"));
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/modules/[id]/courses", () => {
  it("401s with no session and deletes no link", async () => {
    const res = await DELETE(reqWith(anonymousHeaders(), { courseId: "c-mine" }), ctx("m1"));
    expect(res.status).toBe(401);
    expect(linkMock.deleteMany).not.toHaveBeenCalled();
  });

  it("unlinks through the owner-scoped relation filter", async () => {
    const res = await DELETE(reqWith(await authedHeaders(), { courseId: "c-mine" }), ctx("m1"));
    expect(res.status).toBe(200);
    expect(linkMock.deleteMany).toHaveBeenCalledWith({
      where: { moduleId: "m1", courseId: "c-mine", course: { ownerId: TEST_USER_ID } },
    });
  });

  it("resolves a course NAME within the owner, not globally", async () => {
    const res = await DELETE(
      reqWith(await authedHeaders(), { courseName: "Antropologi Ekologi" }),
      ctx("m1"),
    );
    expect(res.status).toBe(200);
    expect(courseMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: TEST_USER_ID, name: "Antropologi Ekologi" } }),
    );
    // Resolved to MY course, never to the other student's row of the same name.
    expect(linkMock.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ courseId: "c-mine" }) }),
    );
  });

  it("404s another student's module id AND mutates nothing", async () => {
    const res = await DELETE(
      reqWith(await authedHeaders(OTHER_USER_ID), { courseId: "c-hers" }),
      ctx("m1"),
    );
    expect(res.status).toBe(404);
    expect(linkMock.deleteMany).not.toHaveBeenCalled();
  });

  it("a courseId owned by someone else deletes nothing (idempotent unlink, no 403)", async () => {
    linkMock.deleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(reqWith(await authedHeaders(), { courseId: "c-hers" }), ctx("m1"));
    expect(res.status).toBe(200);
    // The relation filter is what makes this a no-op instead of a cross-tenant
    // delete; the response says nothing about whether "c-hers" exists.
    expect(linkMock.deleteMany).toHaveBeenCalledWith({
      where: { moduleId: "m1", courseId: "c-hers", course: { ownerId: TEST_USER_ID } },
    });
  });
});
