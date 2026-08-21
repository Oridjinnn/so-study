import { describe, expect, it } from "vitest";
import {
  EXPORT_FOOTER,
  type ExportModule,
  contentTypeFor,
  enrichModule,
  exportFilename,
  parseExportFormat,
  parseRubric,
  toAnkiTSV,
  toMarkdown,
} from "./export";
import {
  analyzeModuleContent,
  deriveStudyGuidance,
} from "@/app/lib/pdfExtract";

function moduleFixture(overrides: Partial<ExportModule> = {}): ExportModule {
  return {
    topicTitle: "Teori Praktik Bourdieu",
    courseNames: ["Teori Antropologi Kontemporer"],
    generatedAt: "2026-08-18T06:00:00.000Z",
    contentMarkdown: "## Konsep kunci\n\nHabitus adalah disposisi terinternalisasi [1].",
    sourcePapers: [
      {
        title: "Outline of a Theory of Practice",
        authors: "Bourdieu, P.",
        year: 1977,
        sourceUrl: "https://openalex.org/W1",
        citationCount: 1200,
      },
    ],
    ...overrides,
  };
}

describe("toMarkdown", () => {
  it("starts with the topic title as an H1", () => {
    expect(toMarkdown(moduleFixture()).startsWith("# Teori Praktik Bourdieu\n")).toBe(true);
  });

  it("lists the courses the module belongs to", () => {
    const md = toMarkdown(moduleFixture({ courseNames: ["Antropologi", "Sosiologi"] }));
    expect(md).toContain("- Mata kuliah: Antropologi, Sosiologi");
  });

  it("says so explicitly when the module has no course", () => {
    expect(toMarkdown(moduleFixture({ courseNames: [] }))).toContain(
      "- Mata kuliah: belum masuk mata kuliah",
    );
  });

  it("keeps the module body verbatim, including inline citations", () => {
    expect(toMarkdown(moduleFixture())).toContain(
      "Habitus adalah disposisi terinternalisasi [1].",
    );
  });

  it("normalises generatedAt to ISO whether given a string or a Date", () => {
    const fromDate = toMarkdown(
      moduleFixture({ generatedAt: new Date("2026-08-18T06:00:00.000Z") }),
    );
    expect(fromDate).toContain("- Modul dibuat: 2026-08-18T06:00:00.000Z");
    expect(toMarkdown(moduleFixture())).toContain("- Modul dibuat: 2026-08-18T06:00:00.000Z");
  });

  it("numbers sources in sourcePaperIds order so [n] still resolves", () => {
    const md = toMarkdown(
      moduleFixture({
        sourcePapers: [
          {
            title: "First",
            authors: "Alice Adams",
            year: 2001,
            sourceUrl: "https://openalex.org/W1",
          },
          {
            title: "Second",
            authors: "Bob Brown",
            year: 2002,
            sourceUrl: "https://openalex.org/W2",
          },
        ],
      }),
    );
    expect(md).toContain("1. Adams, A. (2001). First. https://openalex.org/W1");
    expect(md).toContain("2. Brown, B. (2002). Second. https://openalex.org/W2");
  });

  it("renders each source as an APA-7 reference, not a raw display line", () => {
    // Author display strings are inverted to "Family, I." and the year keeps its
    // APA parentheses; see src/lib/citation.ts.
    expect(toMarkdown(moduleFixture())).toContain(
      "1. Bourdieu, P. (1977). Outline of a Theory of Practice. https://openalex.org/W1",
    );
  });

  it("renders the APA journal form when venue/volume/pages are known", () => {
    const md = toMarkdown(
      moduleFixture({
        sourcePapers: [
          {
            title: "Habitus and practice",
            authors: "Jane Doe, John Smith",
            year: 2020,
            sourceUrl: "https://openalex.org/W3",
            doi: "10.1234/abcd",
            venue: "Journal of Social Theory",
            volume: "12",
            issue: "3",
            pages: "45-67",
            citationCount: 42,
          },
        ],
      }),
    );
    expect(md).toContain(
      "1. Doe, J., & Smith, J. (2020). Habitus and practice. *Journal of Social Theory*, 12(3), 45–67. https://doi.org/10.1234/abcd — 42 sitasi",
    );
  });

  it("italicises a book's title and cites its publisher", () => {
    const md = toMarkdown(
      moduleFixture({
        sourcePapers: [
          {
            title: "The Logic of Practice",
            authors: "Pierre Bourdieu",
            year: 1990,
            sourceUrl: "https://openalex.org/W4",
            publisher: "Polity Press",
            type: "book",
          },
        ],
      }),
    );
    expect(md).toContain(
      "1. Bourdieu, P. (1990). *The Logic of Practice*. Polity Press. https://openalex.org/W4",
    );
  });

  it("includes the citation count when known", () => {
    expect(toMarkdown(moduleFixture())).toContain("— 1200 sitasi");
  });

  it("omits the citation count when unknown instead of printing undefined", () => {
    const md = toMarkdown(
      moduleFixture({
        sourcePapers: [
          { title: "T", authors: "Alice Adams", year: 2001, sourceUrl: "https://openalex.org/W1" },
        ],
      }),
    );
    expect(md).not.toContain("undefined");
    expect(md).not.toContain("sitasi");
  });

  it("omits a zero citation count rather than printing '0 sitasi'", () => {
    const md = toMarkdown(
      moduleFixture({
        sourcePapers: [
          {
            title: "T",
            authors: "Alice Adams",
            year: 2001,
            sourceUrl: "https://openalex.org/W1",
            citationCount: 0,
          },
        ],
      }),
    );
    expect(md).not.toContain("sitasi");
  });

  it("flags a module that has no recorded sources", () => {
    expect(toMarkdown(moduleFixture({ sourcePapers: [] }))).toContain(
      "_Modul ini belum mencatat paper sumber._",
    );
  });

  it("appends the generated essay prompt and rubric when present", () => {
    const md = toMarkdown(
      moduleFixture({ essayPrompt: "Jelaskan habitus.", essayRubric: "1. Definisi 2. Contoh" }),
    );
    expect(md).toContain("## Pertanyaan esai (recall)");
    expect(md).toContain("Jelaskan habitus.");
    expect(md).toContain("### Rubrik penilaian");
    expect(md).toContain("1. Definisi 2. Contoh");
  });

  it("omits the essay section entirely when no prompt was generated", () => {
    const md = toMarkdown(moduleFixture({ essayPrompt: null, essayRubric: null }));
    expect(md).not.toContain("## Pertanyaan esai");
  });

  it("omits the rubric heading when only a prompt exists", () => {
    const md = toMarkdown(moduleFixture({ essayPrompt: "Jelaskan habitus.", essayRubric: "  " }));
    expect(md).toContain("## Pertanyaan esai (recall)");
    expect(md).not.toContain("### Rubrik penilaian");
  });

  it("carries the head-start framing into the exported file", () => {
    expect(toMarkdown(moduleFixture())).toContain(EXPORT_FOOTER);
    expect(EXPORT_FOOTER).toContain("bukan pengganti kuliah");
  });
});

describe("toAnkiTSV", () => {
  const cards = [
    {
      stem: "Apa itu habitus?",
      options: ["Disposisi terinternalisasi", "Aturan formal"],
      answer: "Disposisi terinternalisasi",
      explanation: "Bourdieu menyebutnya struktur terstruktur.",
    },
  ];

  it("emits the Anki file directives the text importer reads", () => {
    const lines = toAnkiTSV(cards, "Teori Praktik").split("\n");
    expect(lines[0]).toBe("#separator:tab");
    expect(lines[1]).toBe("#html:true");
    expect(lines[2]).toBe("#notetype:Basic");
  });

  it("files the notes in a So-study subdeck named after the topic", () => {
    expect(toAnkiTSV(cards, "Teori Praktik")).toContain("#deck:So-study::Teori Praktik");
  });

  it("flattens '::' out of a topic title so it cannot forge deck nesting", () => {
    expect(toAnkiTSV(cards, "Bab 1: Teori")).toContain("#deck:So-study::Bab 1 Teori");
  });

  it("tags every note with a slug so imports stay traceable", () => {
    expect(toAnkiTSV(cards, "Teori Praktik")).toContain("#tags:so-study teori-praktik");
  });

  it("writes exactly one note row per card", () => {
    const rows = toAnkiTSV(cards, "T").trimEnd().split("\n").filter((l) => !l.startsWith("#"));
    expect(rows).toHaveLength(1);
    expect(rows[0].split("\t")).toHaveLength(2);
  });

  it("puts labelled options on the front and the answer on the back", () => {
    const [front, back] = toAnkiTSV(cards, "T")
      .trimEnd()
      .split("\n")
      .filter((l) => !l.startsWith("#"))[0]
      .split("\t");
    expect(front).toContain("Apa itu habitus?");
    expect(front).toContain("A. Disposisi terinternalisasi");
    expect(front).toContain("B. Aturan formal");
    expect(back).toContain("Jawaban: Disposisi terinternalisasi");
    expect(back).toContain("Bourdieu menyebutnya struktur terstruktur.");
  });

  it("still exports a card that has no options (plain front/back)", () => {
    const row = toAnkiTSV([{ stem: "Sebutkan habitus", options: [], answer: "Disposisi" }], "T")
      .trimEnd()
      .split("\n")
      .filter((l) => !l.startsWith("#"))[0];
    expect(row).toBe("Sebutkan habitus\tJawaban: Disposisi");
  });

  it("never lets a tab or newline inside a field break the row/column layout", () => {
    const out = toAnkiTSV(
      [{ stem: "Baris satu\nbaris dua\tkolom", options: [], answer: "A\tB" }],
      "T",
    );
    const rows = out.trimEnd().split("\n").filter((l) => !l.startsWith("#"));
    expect(rows).toHaveLength(1);
    expect(rows[0].split("\t")).toHaveLength(2);
    expect(rows[0]).toContain("Baris satu<br>baris dua");
  });

  it("escapes HTML so module markup cannot corrupt a card", () => {
    const out = toAnkiTSV([{ stem: "<b>bold</b> & co", options: [], answer: "x" }], "T");
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; co");
  });

  it("omits the explanation block when there is none", () => {
    const row = toAnkiTSV(
      [{ stem: "S", options: ["a", "b"], answer: "a", explanation: null }],
      "T",
    )
      .trimEnd()
      .split("\n")
      .filter((l) => !l.startsWith("#"))[0];
    expect(row.split("\t")[1]).toBe("Jawaban: a");
  });

  it("emits only directives when there are no cards", () => {
    const rows = toAnkiTSV([], "T").trimEnd().split("\n");
    expect(rows.every((l) => l.startsWith("#"))).toBe(true);
  });
});

describe("parseExportFormat", () => {
  it("accepts the three supported formats", () => {
    expect(parseExportFormat("md")).toBe("md");
    expect(parseExportFormat("anki")).toBe("anki");
    expect(parseExportFormat("pdf")).toBe("pdf");
  });

  it("rejects anything else, including a missing param", () => {
    expect(parseExportFormat("")).toBeNull();
    expect(parseExportFormat(null)).toBeNull();
    expect(parseExportFormat("MD")).toBeNull();
    expect(parseExportFormat("docx")).toBeNull();
  });
});

describe("exportFilename", () => {
  it("slugifies the topic title and uses the format's extension", () => {
    expect(exportFilename("Teori Praktik Bourdieu", "md")).toBe("so-study-teori-praktik-bourdieu.md");
    expect(exportFilename("Teori Praktik Bourdieu", "anki")).toBe("so-study-teori-praktik-bourdieu.tsv");
    expect(exportFilename("Teori Praktik Bourdieu", "pdf")).toBe("so-study-teori-praktik-bourdieu.pdf");
  });

  it("strips punctuation that would be unsafe in a filename", () => {
    expect(exportFilename("Bab 1: Teori/Praktik!", "md")).toBe("so-study-bab-1-teoripraktik.md");
  });

  it("falls back to a generic name for an unusable title", () => {
    expect(exportFilename("", "md")).toBe("so-study-modul.md");
    expect(exportFilename("!!!", "anki")).toBe("so-study-modul.tsv");
  });
});

describe("contentTypeFor", () => {
  it("serves markdown as text/markdown", () => {
    expect(contentTypeFor("md")).toBe("text/markdown; charset=utf-8");
  });

  it("serves Anki notes as tab-separated values", () => {
    expect(contentTypeFor("anki")).toBe("text/tab-separated-values; charset=utf-8");
  });

  it("serves the server-generated PDF as application/pdf", () => {
    expect(contentTypeFor("pdf")).toBe("application/pdf");
  });
});

describe("parseRubric", () => {
  const RUBRIC = [
    "Rubrik esai (dibuat otomatis dari struktur modul):",
    "",
    "A. Penulisan (clarity):",
    "  - Bahasa jelas, terstruktur, dan kohesif; setiap paragraf fokus pada satu ide.",
    "  - Istilah modul digunakan tepat; tidak ada ambiguitas atau salah kaprah besar.",
    "",
    "B. Penafsiran (interpretation):",
    "  1. Menafsirkan konsep kunci \"habitus\" secara akurat (bukan sekadar menyebut).",
    "  - Menafsirkan klaim/argumen tiap sumber secara akurat, bukan sekadar mengutip.",
    "",
    "C. Penalaran (reasoning):",
    "  - Argumen logis dan runtut: bukti → analisis → kesimpulan; menjawab kerangka",
    "    5W1H (Apa/Siapa/Kapan/Di mana/Mengapa/Bagaimana) untuk topik ini.",
  ].join("\n");

  it("splits the harness rubric into lettered sections with their criteria", () => {
    const sections = parseRubric(RUBRIC);
    expect(sections.map((s) => s.letter)).toEqual(["A", "B", "C"]);
    expect(sections[0].title).toBe("Penulisan (clarity)");
    expect(sections[0].items).toContain(
      "Bahasa jelas, terstruktur, dan kohesif; setiap paragraf fokus pada satu ide.",
    );
  });

  it("keeps the penulisan/penafsiran/penalaran framing", () => {
    const text = parseRubric(RUBRIC)
      .map((s) => s.title)
      .join(" ");
    expect(text).toContain("Penulisan");
    expect(text).toContain("Penafsiran");
    expect(text).toContain("Penalaran");
  });

  it("merges a wrapped continuation line back into its bullet", () => {
    const penalaran = parseRubric(RUBRIC).find((s) => s.letter === "C");
    expect(penalaran?.items[0]).toContain("5W1H");
    expect(penalaran?.items[0]).toContain("bukti → analisis → kesimpulan");
  });

  it("returns no sections for flat, unsectioned rubric text", () => {
    expect(parseRubric("Tulis esai yang jelas dan terstruktur.")).toEqual([]);
  });
});

describe("analyzeModuleContent", () => {
  it("pulls key concepts from a Konsep kunci section", () => {
    const md = "## Konsep kunci\n\n- Habitus: disposisi terinternalisasi.\n- Habitualitas: pengulangan pola dalam praktik.";
    const a = analyzeModuleContent(md);
    expect(a.keyConcepts).toContain("Habitus");
    expect(a.keyConcepts).toContain("Habitualitas");
  });

  it("records the highest inline [n] citation used", () => {
    const a = analyzeModuleContent("Klaim A [1]. Klaim B [3].");
    expect(a.citationCount).toBe(3);
  });

  it("captures argument lines from an Argumen section", () => {
    const md = "## Argumen utama tiap sumber\n\n- Habitus memengaruhi pemahaman dunia sosial.\n- Struktur membandingkan habitus dengan struktur.";
    const a = analyzeModuleContent(md);
    expect(a.keyArguments.some((x) => x.includes("Habitus memengaruhi"))).toBe(true);
  });
});

describe("deriveStudyGuidance", () => {
  it("frames recall around the module's own concepts when present", () => {
    const a = analyzeModuleContent("## Konsep kunci\n\n- Habitus: disposisi.");
    const g = deriveStudyGuidance(a, null);
    expect(g[0]).toContain("Habitus");
    // The reasoning framing is always present alongside the concept recall.
    expect(g.join(" ")).toContain("penalaran");
  });

  it("frames interpretation around the citation range when sources are cited", () => {
    const g = deriveStudyGuidance({ keyConcepts: [], keyArguments: [], citationCount: 2 }, null);
    expect(g.join(" ")).toContain("[1]–[2]");
    expect(g.join(" ")).toContain("penafsiran");
  });

  it("always frames reasoning with the 5W1H chain", () => {
    const g = deriveStudyGuidance({ keyConcepts: [], keyArguments: [], citationCount: 0 }, null);
    expect(g.join(" ")).toContain("5W1H");
    expect(g.join(" ")).toContain("penalaran");
  });

  it("points at the essay + rubric when a prompt exists", () => {
    const g = deriveStudyGuidance({ keyConcepts: [], keyArguments: [], citationCount: 0 }, "Jelaskan habitus.");
    expect(g.some((x) => x.toLowerCase().includes("rubrik"))).toBe(true);
  });
});

describe("enrichModule", () => {
  it("populates derived guidance/concepts/rubric without dropping the source fields", () => {
    const base = moduleFixture({
      essayPrompt: "Jelaskan habitus.",
      essayRubric: "A. Penulisan (clarity):\n  - Bahasa jelas.\nB. Penafsiran (interpretation):\n  - Menafsirkan akurat.",
    });
    const enriched = enrichModule(base);
    expect(enriched.studyGuidance?.length).toBeGreaterThan(0);
    expect(enriched.studyGuidance?.join(" ")).toContain("penalaran");
    expect(enriched.keyConcepts).toEqual(expect.any(Array));
    expect(enriched.rubricSections?.map((s) => s.letter)).toEqual(["A", "B"]);
    // Original contract fields survive untouched.
    expect(enriched.topicTitle).toBe(base.topicTitle);
    expect(enriched.sourcePapers).toBe(base.sourcePapers);
    expect(enriched.essayPrompt).toBe("Jelaskan habitus.");
  });

  it("yields an empty rubric section list when no rubric was generated", () => {
    expect(enrichModule(moduleFixture({ essayRubric: null })).rubricSections).toEqual([]);
  });
});
