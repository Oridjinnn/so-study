import { describe, expect, it, vi, beforeEach } from "vitest";
import { PDFParse } from "pdf-parse";

vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    module: { findFirst: vi.fn() },
    paper: { findMany: vi.fn() },
    questionBankItem: { findMany: vi.fn() },
  },
}));

import { NextRequest } from "next/server";
import { GET } from "./route";
import { prisma } from "@/src/lib/prisma";
import { OTHER_USER_ID, TEST_USER_ID, sessionCookie } from "@/src/lib/testAuth";

const moduleMock = prisma.module as unknown as { findFirst: ReturnType<typeof vi.fn> };
const paperMock = prisma.paper as unknown as { findMany: ReturnType<typeof vi.fn> };
const bankMock = prisma.questionBankItem as unknown as { findMany: ReturnType<typeof vi.fn> };

/**
 * A real, correctly-signed session cookie on a real NextRequest — the route reads
 * `nextUrl.searchParams`, so it must stay a NextRequest, and the cookie must go
 * through the same verification production uses (src/lib/testAuth.ts).
 */
async function makeReq(format: string | null, userId: string = TEST_USER_ID) {
  const url = `http://localhost/api/modules/1/export${format ? `?format=${format}` : ""}`;
  return new NextRequest(url, { headers: { cookie: await sessionCookie(userId) } });
}

/** Same URL with no cookie at all — the 401 case. */
function anonReq(format: string) {
  return new NextRequest(`http://localhost/api/modules/1/export?format=${format}`);
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const moduleFixture = {
  id: "1",
  ownerId: TEST_USER_ID,
  topicId: "t1",
  topic: { title: "Teori Praktik Bourdieu" },
  courses: [{ course: { name: "Antropologi" } }],
  generatedAt: "2026-08-18T06:00:00.000Z",
  contentMarkdown: "## Konsep kunci\n\nHabitus adalah **disposisi** terinternalisasi [1].",
  essayPrompt: null,
  essayRubric: null,
  sourcePaperIds: JSON.stringify(["p1"]),
};

const paperFixture = [
  {
    id: "p1",
    title: "Outline of a Theory of Practice",
    authors: "Bourdieu, P.",
    year: 1977,
    sourceUrl: "https://openalex.org/W1",
    citationCount: 1200,
  },
];

beforeEach(() => {
  moduleMock.findFirst.mockReset();
  paperMock.findMany.mockReset();
  bankMock.findMany.mockReset();
  // Fake table: the module is only visible to its owner, so a request signed as
  // the other student gets null exactly as Postgres would.
  moduleMock.findFirst.mockImplementation(
    async ({ where }: { where: { id: string; ownerId: string } }) =>
      where.ownerId === moduleFixture.ownerId ? moduleFixture : null,
  );
  paperMock.findMany.mockResolvedValue(paperFixture);
  bankMock.findMany.mockResolvedValue([]);
});

describe("GET /api/modules/[id]/export?format=pdf", () => {
  it("returns a real PDF with the right headers", async () => {
    const res = await GET(await makeReq("pdf"), ctx("1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("so-study-teori-praktik-bourdieu.pdf");

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("still carries the inline citation and the grounding source in the PDF", async () => {
    const res = await GET(await makeReq("pdf"), ctx("1"));
    const buf = Buffer.from(await res.arrayBuffer());

    // pdfmake compresses its streams, so the literal text isn't in the raw
    // bytes — extract it with the same pdf-parse the app already uses.
    const parser = new PDFParse({ data: buf });
    const { text } = await parser.getText();
    // The citation marker and the source title must survive the conversion.
    expect(text).toContain("[1]");
    expect(text).toContain("Outline of a Theory of Practice");
    // The module title is the running header/footer too.
    expect(text).toContain("Teori Praktik Bourdieu");
  }, 30000);

  it("renders the derived study-guidance block (Petunjuk belajar) near the top", async () => {
    const res = await GET(await makeReq("pdf"), ctx("1"));
    const buf = Buffer.from(await res.arrayBuffer());
    const parser = new PDFParse({ data: buf });
    const { text } = await parser.getText();
    expect(text).toContain("Petunjuk belajar");
    // The guidance is derived from the module's own concept ("Habitus"), not
    // hardcoded marketing copy.
    expect(text).toContain("Habitus");
    expect(text).toContain("penalaran");
  }, 30000);
});

describe("GET /api/modules/[id]/export?format=pdf rubric", () => {
  const rubricModule = {
    ...moduleFixture,
    essayPrompt: "Jelaskan habitus dengan kata sendiri.",
    essayRubric: [
      "Rubrik esai (dibuat otomatis dari struktur modul):",
      "",
      "A. Penulisan (clarity):",
      "  - Bahasa jelas, terstruktur, dan kohesif; setiap paragraf fokus pada satu ide.",
      "",
      "B. Penafsiran (interpretation):",
      '  1. Menafsirkan konsep kunci "habitus" secara akurat (bukan sekadar menyebut).',
      "",
      "C. Penalaran (reasoning):",
      "  - Argumen logis dan runtut: bukti → analisis → kesimpulan; menjawab kerangka",
      "    5W1H (Apa/Siapa/Kapan/Di mana/Mengapa/Bagaimana) untuk topik ini.",
    ].join("\n"),
  };

  it("renders the rubric as a structured checklist (penulisan/penafsiran/penalaran)", async () => {
    moduleMock.findFirst.mockResolvedValue(rubricModule);
    const res = await GET(await makeReq("pdf"), ctx("1"));
    const buf = Buffer.from(await res.arrayBuffer());
    const parser = new PDFParse({ data: buf });
    const { text } = await parser.getText();
    expect(text).toContain("Penulisan");
    expect(text).toContain("Penafsiran");
    expect(text).toContain("Penalaran");
    // A concrete criterion (not just the section headings) survives the render.
    // (pdf-parse drops the `→` glyph, so assert on the surrounding words.)
    expect(text).toContain("bukti");
    expect(text).toContain("kesimpulan");
  }, 30000);
});

describe("GET /api/modules/[id]/export format validation", () => {
  it("rejects an unknown format with 400", async () => {
    const res = await GET(await makeReq("docx"), ctx("1"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the module does not exist", async () => {
    moduleMock.findFirst.mockResolvedValue(null);
    const res = await GET(await makeReq("pdf"), ctx("nope"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/modules/[id]/export tenancy", () => {
  it("401s an anonymous download before any query — a file leak is silent", async () => {
    const res = await GET(anonReq("md"), ctx("1"));
    expect(res.status).toBe(401);
    expect(moduleMock.findFirst).not.toHaveBeenCalled();
  });

  it("scopes the module read by ownerId (not findUnique by id)", async () => {
    const res = await GET(await makeReq("md"), ctx("1"));
    expect(res.status).toBe(200);
    expect(moduleMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "1", ownerId: TEST_USER_ID } }),
    );
  });

  it("404s another student's module and exports nothing", async () => {
    const res = await GET(await makeReq("md", OTHER_USER_ID), ctx("1"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Modul tidak ditemukan." });
    // No content-disposition, no question bank read: the export never started.
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(bankMock.findMany).not.toHaveBeenCalled();
  });

  it("scopes the Anki question bank through its topic's owner", async () => {
    const res = await GET(await makeReq("anki"), ctx("1"));
    expect(res.status).toBe(200);
    expect(bankMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { topicId: "t1", topic: { ownerId: TEST_USER_ID } } }),
    );
  });
});
