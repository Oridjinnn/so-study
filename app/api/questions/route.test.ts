import { describe, expect, it, vi, beforeEach } from "vitest";
import { TEST_USER_ID, anonymousHeaders, authedHeaders } from "@/src/lib/testAuth";

// This route had NO test before, which is how it kept a `findUnique({ where:
// { id } })` on the question bank: PATCH/DELETE would happily edit another
// student's item. QuestionBankItem carries no ownerId, so every assertion below
// is about the relation filter `topic: { ownerId }`.
vi.mock("@/src/lib/prisma", () => {
  const questionBankItem = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const topic = { findFirst: vi.fn() };
  // `moduleDelegate` rather than `module`: the bare name trips the Next.js lint
  // rule about assigning to the CommonJS `module` global.
  const moduleDelegate = { findFirst: vi.fn() };
  return { prisma: { questionBankItem, topic, module: moduleDelegate } };
});

import { GET, POST, PATCH, DELETE } from "./route";
import { prisma } from "@/src/lib/prisma";

const bank = prisma.questionBankItem as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};
const topic = prisma.topic as unknown as { findFirst: ReturnType<typeof vi.fn> };
const mod = prisma.module as unknown as { findFirst: ReturnType<typeof vi.fn> };

const ROW = {
  id: "qb1",
  topicId: "t1",
  moduleId: null,
  stem: "Apa itu habitus?",
  options: JSON.stringify(["a", "b"]),
  answer: "a",
  explanation: null,
  author: "student",
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function getReq(query: string, userId?: string) {
  return { nextUrl: new URL(`http://x/api/questions${query}`), headers: await authedHeaders(userId) } as never;
}

async function bodyReq(body: unknown, query = "", userId?: string) {
  return {
    json: async () => body,
    nextUrl: new URL(`http://x/api/questions${query}`),
    headers: await authedHeaders(userId),
  } as never;
}

function anonReq(body: unknown, query = "") {
  return {
    json: async () => body,
    nextUrl: new URL(`http://x/api/questions${query}`),
    headers: anonymousHeaders(),
  } as never;
}

const VALID_POST = {
  topicId: "t1",
  stem: "Apa itu habitus?",
  options: ["disposisi", "benda"],
  answer: "disposisi",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/questions", () => {
  it("401s a request with no session cookie", async () => {
    const res = await GET(anonReq(null, "?topicId=t1"));
    expect(res.status).toBe(401);
    expect(bank.findMany).not.toHaveBeenCalled();
  });

  it("requires topicId or courseId", async () => {
    const res = await GET(await getReq(""));
    expect(res.status).toBe(400);
  });

  it("scopes a topic listing through the topic owner", async () => {
    bank.findMany.mockResolvedValue([ROW]);
    const res = await GET(await getReq("?topicId=t1"));
    expect(res.status).toBe(200);
    expect(bank.findMany).toHaveBeenCalledWith({
      where: { topicId: "t1", topic: { ownerId: TEST_USER_ID } },
      orderBy: { createdAt: "asc" },
    });
  });

  it("scopes a course listing through the topic owner too", async () => {
    bank.findMany.mockResolvedValue([]);
    await GET(await getReq("?courseId=c1"));
    expect(bank.findMany).toHaveBeenCalledWith({
      where: { topic: { courseId: "c1", ownerId: TEST_USER_ID } },
      orderBy: { createdAt: "asc" },
    });
  });

  it("returns an empty bank for another student's topic instead of her items", async () => {
    bank.findMany.mockResolvedValue([]);
    const res = await GET(await getReq("?topicId=her-topic"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [] });
  });
});

describe("POST /api/questions", () => {
  it("401s a request with no session cookie", async () => {
    const res = await POST(anonReq(VALID_POST));
    expect(res.status).toBe(401);
    expect(bank.create).not.toHaveBeenCalled();
  });

  it("creates an item under a topic the caller owns", async () => {
    topic.findFirst.mockResolvedValue({ id: "t1" });
    bank.create.mockResolvedValue(ROW);
    const res = await POST(await bodyReq(VALID_POST));
    expect(res.status).toBe(201);
    expect(topic.findFirst).toHaveBeenCalledWith({
      where: { id: "t1", ownerId: TEST_USER_ID },
      select: { id: true },
    });
    expect(bank.create).toHaveBeenCalledTimes(1);
  });

  it("404s another student's topic and plants NOTHING in her bank", async () => {
    topic.findFirst.mockResolvedValue(null);
    const res = await POST(await bodyReq({ ...VALID_POST, topicId: "her-topic" }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Topik tidak ditemukan." });
    expect(bank.create).not.toHaveBeenCalled();
  });

  it("404s a moduleId that is not the caller's (it is stored as a bare pointer)", async () => {
    topic.findFirst.mockResolvedValue({ id: "t1" });
    mod.findFirst.mockResolvedValue(null);
    const res = await POST(await bodyReq({ ...VALID_POST, moduleId: "her-module" }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Modul tidak ditemukan." });
    expect(bank.create).not.toHaveBeenCalled();
  });

  it("still validates the payload (2 options, answer among them)", async () => {
    topic.findFirst.mockResolvedValue({ id: "t1" });
    const res = await POST(await bodyReq({ topicId: "t1", stem: "x", options: ["only"], answer: "only" }));
    expect(res.status).toBe(400);
    expect(bank.create).not.toHaveBeenCalled();
  });

  it("dedupes an AI item within the caller's own bank only", async () => {
    topic.findFirst.mockResolvedValue({ id: "t1" });
    bank.findFirst.mockResolvedValue(ROW);
    const res = await POST(await bodyReq({ ...VALID_POST, author: "ai" }));
    expect(res.status).toBe(200);
    expect(bank.findFirst).toHaveBeenCalledWith({
      where: {
        topicId: "t1",
        stem: "Apa itu habitus?",
        author: "ai",
        topic: { ownerId: TEST_USER_ID },
      },
    });
    expect(bank.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/questions", () => {
  it("401s a request with no session cookie", async () => {
    const res = await PATCH(anonReq({ stem: "baru" }, "?id=qb1"));
    expect(res.status).toBe(401);
    expect(bank.update).not.toHaveBeenCalled();
  });

  it("edits an item the caller owns", async () => {
    bank.findFirst.mockResolvedValue(ROW);
    bank.update.mockResolvedValue({ ...ROW, stem: "baru" });
    const res = await PATCH(await bodyReq({ stem: "baru" }, "?id=qb1"));
    expect(res.status).toBe(200);
    expect(bank.findFirst).toHaveBeenCalledWith({
      where: { id: "qb1", topic: { ownerId: TEST_USER_ID } },
    });
  });

  it("404s another student's item and does NOT update it", async () => {
    bank.findFirst.mockResolvedValue(null); // invisible to the owner-scoped lookup
    const res = await PATCH(await bodyReq({ stem: "dirusak" }, "?id=her-item"));
    expect(res.status).toBe(404);
    expect(bank.update).not.toHaveBeenCalled();
  });

  it("keeps the AI-authored items read-only (403, an unrelated rule)", async () => {
    bank.findFirst.mockResolvedValue({ ...ROW, author: "ai" });
    const res = await PATCH(await bodyReq({ stem: "baru" }, "?id=qb1"));
    expect(res.status).toBe(403);
    expect(bank.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/questions", () => {
  it("401s a request with no session cookie", async () => {
    const res = await DELETE(anonReq(null, "?id=qb1"));
    expect(res.status).toBe(401);
    expect(bank.delete).not.toHaveBeenCalled();
  });

  it("deletes an item the caller owns", async () => {
    bank.findFirst.mockResolvedValue(ROW);
    bank.delete.mockResolvedValue(ROW);
    const res = await DELETE(await bodyReq(null, "?id=qb1"));
    expect(res.status).toBe(200);
    expect(bank.findFirst).toHaveBeenCalledWith({
      where: { id: "qb1", topic: { ownerId: TEST_USER_ID } },
    });
    expect(bank.delete).toHaveBeenCalledWith({ where: { id: "qb1" } });
  });

  it("404s another student's item and deletes NOTHING", async () => {
    bank.findFirst.mockResolvedValue(null);
    const res = await DELETE(await bodyReq(null, "?id=her-item"));
    expect(res.status).toBe(404);
    expect(bank.delete).not.toHaveBeenCalled();
  });
});
