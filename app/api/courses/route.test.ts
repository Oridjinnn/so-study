import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const course = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    upsert: vi.fn(),
  };
  return {
    prisma: {
      course,
      // The batch path wraps the per-course `create` calls in a transaction;
      // resolve it by running the queued operations.
      $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    },
  };
});

import { POST, GET, normalizeCourseNames } from "./route";
import { prisma } from "@/src/lib/prisma";
import {
  TEST_USER_ID,
  authedHeaders,
  anonymousHeaders,
} from "@/src/lib/testAuth";

const course = prisma.course as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};

function makeReq(body: unknown, headers?: { get: (name: string) => string | null }) {
  return {
    json: async () => body,
    headers: headers ?? { get: () => null },
  } as never;
}

// Change 4: a semester is pasted in one go, so the normalizer is the guard
// between "what the student pasted" and "what gets created".
describe("normalizeCourseNames", () => {
  it("trims entries and drops the blank lines paste produces", () => {
    const { names } = normalizeCourseNames([
      "  Teori Antropologi Kontemporer  ",
      "",
      "   ",
      "Antropologi Ekologi",
    ]);
    expect(names).toEqual(["Teori Antropologi Kontemporer", "Antropologi Ekologi"]);
  });

  it("collapses duplicates case-insensitively and reports them", () => {
    const { names, duplicates } = normalizeCourseNames([
      "Antropologi Ekologi",
      "antropologi ekologi",
      "ANTROPOLOGI EKOLOGI",
    ]);
    // The DB unique index is case-sensitive, so without this all three would be
    // created as separate courses — almost always a typo, not an intent.
    expect(names).toEqual(["Antropologi Ekologi"]);
    expect(duplicates).toHaveLength(2);
  });

  it("keeps the first spelling of a duplicate", () => {
    const { names } = normalizeCourseNames(["Etnografi", "ETNOGRAFI"]);
    expect(names).toEqual(["Etnografi"]);
  });

  it("returns nothing usable for an all-blank submission", () => {
    expect(normalizeCourseNames(["", "  ", "\t"]).names).toEqual([]);
  });

  it("ignores non-string entries instead of coercing them", () => {
    const { names } = normalizeCourseNames([null, 42, undefined, { name: "x" }, "Valid"]);
    expect(names).toEqual(["Valid"]);
  });

  it("preserves distinct names and their order", () => {
    const { names } = normalizeCourseNames(["C", "A", "B"]);
    expect(names).toEqual(["C", "A", "B"]);
  });

  it("keeps commas inside a single course name", () => {
    // Splitting happens client-side; by this point one entry is one course.
    const { names } = normalizeCourseNames(["Statistik, Data, dan Masyarakat"]);
    expect(names).toEqual(["Statistik, Data, dan Masyarakat"]);
  });
});

describe("authentication", () => {
  it("401s a course list request with no session", async () => {
    const res = await GET(makeReq(null, await anonymousHeaders()));
    expect(res.status).toBe(401);
  });

  it("401s a course create with no session", async () => {
    const res = await POST(makeReq({ name: "X" }, await anonymousHeaders()));
    expect(res.status).toBe(401);
    expect(course.create).not.toHaveBeenCalled();
    expect(course.upsert).not.toHaveBeenCalled();
  });
});

describe("GET /api/courses", () => {
  beforeEach(() => {
    course.findMany.mockReset();
  });

  it("scopes the listing to the logged-in student, never a shared list", async () => {
    course.findMany.mockResolvedValue([]);
    const res = await GET(makeReq(null, await authedHeaders()));
    expect(res.status).toBe(200);
    // The owner is folded into the read itself: another student's courses are
    // simply absent from the query result, not returned and filtered later.
    expect(course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: TEST_USER_ID } }),
    );
  });
});

// The wizard (and the batch-importer) POST to this same endpoint — these guard
// the contract the onboarding flow depends on.
describe("POST /api/courses (batch)", () => {
  beforeEach(() => {
    course.findMany.mockReset();
    course.findFirst.mockReset();
    course.create.mockReset();
    course.upsert.mockReset();
    (prisma as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction.mockReset();
    course.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: "id",
      ...args.data,
    }));
  });

  it("dedupes names before creating (collapses case-insensitive repeats)", async () => {
    course.findMany.mockResolvedValue([]);
    const res = await POST(makeReq({ names: ["A", "a", "A"], major: "Antropologi" }, await authedHeaders()));
    expect(res.status).toBe(201);
    // Only one create despite three submitted names.
    expect(course.create).toHaveBeenCalledTimes(1);
    expect(course.create.mock.calls[0][0].data).toEqual({ name: "A", ownerId: TEST_USER_ID, major: "Antropologi" });
  });

  it("stamps every created course with the caller's ownerId", async () => {
    course.findMany.mockResolvedValue([]);
    await POST(makeReq({ names: ["Satu", "Dua"], major: "Sosiologi" }, await authedHeaders()));
    const owners = course.create.mock.calls.map((c) => c[0].data.ownerId);
    expect(owners).toEqual([TEST_USER_ID, TEST_USER_ID]);
  });

  it("a name another student already owns does NOT block my import (per-owner, not global)", async () => {
    // The pre-check is now owner-scoped, so the DB only returns rows matching
    // MY ownerId. We model that here as "nothing came back for me", which is
    // exactly what the query yields when a name is taken only by someone else.
    course.findMany.mockResolvedValue([]);
    const res = await POST(makeReq({ names: ["X"] }, await authedHeaders()));
    expect(res.status).toBe(201);
    expect(course.create).toHaveBeenCalledTimes(1);
  });

  it("409 with conflicts when the name already exists for THIS student", async () => {
    course.findMany.mockResolvedValue([{ name: "X", ownerId: TEST_USER_ID }]);
    const res = await POST(makeReq({ names: ["X"] }, await authedHeaders()));
    expect(res.status).toBe(409);
    expect((await res.json()).conflicts).toEqual(["X"]);
    expect(course.create).not.toHaveBeenCalled();
  });

  it("propagates the shared major to every created course", async () => {
    course.findMany.mockResolvedValue([]);
    const res = await POST(makeReq({ names: ["Satu", "Dua"], major: "Sosiologi" }, await authedHeaders()));
    expect(res.status).toBe(201);
    const majors = course.create.mock.calls.map((c) => c[0].data.major);
    expect(majors).toEqual(["Sosiologi", "Sosiologi"]);
  });

  it("creates courses without a major when none is provided", async () => {
    course.findMany.mockResolvedValue([]);
    const res = await POST(makeReq({ names: ["Satu"] }, await authedHeaders()));
    expect(res.status).toBe(201);
    expect(course.create.mock.calls[0][0].data).toEqual({ name: "Satu", ownerId: TEST_USER_ID });
  });
});

describe("POST /api/courses (single, idempotent upsert)", () => {
  beforeEach(() => {
    course.findFirst.mockReset();
    course.upsert.mockReset();
    course.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
      id: "id",
      name: (args.create as { name: string }).name,
      major: (args.create as { major?: string }).major ?? null,
    }));
  });

  it("upserts against the (ownerId, name) compound key, not the global name", async () => {
    course.findFirst.mockResolvedValue(null);
    const res = await POST(makeReq({ name: "Sosiologi", major: "Sosiologi" }, await authedHeaders()));
    expect(res.status).toBe(200);
    expect(course.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId_name: { ownerId: TEST_USER_ID, name: "Sosiologi" } },
        create: { name: "Sosiologi", ownerId: TEST_USER_ID, major: "Sosiologi" },
      }),
    );
  });

  it("does not leak another student's existing major when backfilling", async () => {
    // A name the OTHER student owns is invisible to my findFirst, so I create my
    // own row under the same name — no cross-account read, just my own course.
    course.findFirst.mockResolvedValue(null);
    await POST(makeReq({ name: "Umum" }, await authedHeaders()));
    expect(course.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Umum", ownerId: TEST_USER_ID } }),
    );
  });
});
