import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/prisma", () => {
  const course = {
    findMany: vi.fn(),
    findUnique: vi.fn(),
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

import { POST, normalizeCourseNames } from "./route";
import { prisma } from "@/src/lib/prisma";

const course = prisma.course as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};

function makeReq(body: unknown) {
  return {
    json: async () => body,
    headers: { get: () => null },
  } as never;
}

// Change 4: a semester is pasted in one go, so the normalizer is the guard
// between "what the student pasted" and "what gets created".
describe("normalizeCourseNames", () => {
  it("trims entries and drops the blank lines pasting produces", () => {
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

// The wizard (and the batch-importer) POST to this same endpoint — these guard
// the contract the onboarding flow depends on.
describe("POST /api/courses (batch)", () => {
  beforeEach(() => {
    course.findMany.mockReset();
    course.findUnique.mockReset();
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
    const res = await POST(makeReq({ names: ["A", "a", "A"], major: "Antropologi" }));
    expect(res.status).toBe(201);
    // Only one create despite three submitted names.
    expect(course.create).toHaveBeenCalledTimes(1);
    expect(course.create.mock.calls[0][0].data).toEqual({ name: "A", major: "Antropologi" });
  });

  it("returns 409 with conflicts when a name already exists", async () => {
    course.findMany.mockResolvedValue([{ name: "X" }]);
    const res = await POST(makeReq({ names: ["X"] }));
    expect(res.status).toBe(409);
    expect((await res.json()).conflicts).toEqual(["X"]);
    expect(course.create).not.toHaveBeenCalled();
  });

  it("propagates the shared major to every created course", async () => {
    course.findMany.mockResolvedValue([]);
    const res = await POST(makeReq({ names: ["Satu", "Dua"], major: "Sosiologi" }));
    expect(res.status).toBe(201);
    const majors = course.create.mock.calls.map((c) => c[0].data.major);
    expect(majors).toEqual(["Sosiologi", "Sosiologi"]);
  });

  it("creates courses without a major when none is provided", async () => {
    course.findMany.mockResolvedValue([]);
    const res = await POST(makeReq({ names: ["Satu"] }));
    expect(res.status).toBe(201);
    expect(course.create.mock.calls[0][0].data).toEqual({ name: "Satu" });
  });
});
