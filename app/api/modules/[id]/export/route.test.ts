import { describe, expect, it, vi, beforeEach } from "vitest";
import { PDFParse } from "pdf-parse";

vi.mock("@/src/lib/prisma", () => ({
  prisma: {
    module: { findUnique: vi.fn() },
    paper: { findMany: vi.fn() },
    questionBankItem: { findMany: vi.fn() },
  },
}));

import { NextRequest } from "next/server";
import { GET } from "./route";
import { prisma } from "@/src/lib/prisma";

const moduleMock = prisma.module as unknown as { findUnique: ReturnType<typeof vi.fn> };
const paperMock = prisma.paper as unknown as { findMany: ReturnType<typeof vi.fn> };

function makeReq(format: string | null) {
  const url = `http://localhost/api/modules/1/export${format ? `?format=${format}` : ""}`;
  return new NextRequest(url);
}

const moduleFixture = {
  id: "1",
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
  moduleMock.findUnique.mockReset();
  paperMock.findMany.mockReset();
  moduleMock.findUnique.mockResolvedValue(moduleFixture);
  paperMock.findMany.mockResolvedValue(paperFixture);
});

describe("GET /api/modules/[id]/export?format=pdf", () => {
  it("returns a real PDF with the right headers", async () => {
    const res = await GET(makeReq("pdf"), { params: Promise.resolve({ id: "1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain("so-study-teori-praktik-bourdieu.pdf");

    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("still carries the inline citation and the grounding source in the PDF", async () => {
    const res = await GET(makeReq("pdf"), { params: Promise.resolve({ id: "1" }) });
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
    const res = await GET(makeReq("pdf"), { params: Promise.resolve({ id: "1" }) });
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
    moduleMock.findUnique.mockResolvedValue(rubricModule);
    const res = await GET(makeReq("pdf"), { params: Promise.resolve({ id: "1" }) });
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
    const res = await GET(makeReq("docx"), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the module does not exist", async () => {
    moduleMock.findUnique.mockResolvedValue(null);
    const res = await GET(makeReq("pdf"), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});
