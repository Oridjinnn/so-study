// Server-side PDF generation for module export (roadmap Phase 3).
//
// This replaces the old `window.print()` path: instead of handing the browser's
// native print dialog to the student (on iPad Safari that hides "Save as PDF"
// behind a pinch-out gesture most users never find), we render a real PDF here
// on the server and stream it back as a download.
//
// Library choice: `pdfmake` over a headless browser. A real Chromium in a
// serverless function is heavy (cold starts, package-size limits) and breaks
// the project's zero-infra-cost constraint. pdfmake is pure JS and, crucially,
// ships its own embedded font (Roboto) inside its virtual file system — no
// runtime font files to read, so it works in a traced Vercel serverless bundle
// with nothing extra to deploy. The reader's own font is Geist (only available
// via next/font as a build-time woff2), so we keep Roboto here to stay lean and
// dependency-free on the server.
//
// The markdown AST is shared with the reader (`app/lib/markdownBlocks.ts`) so
// the PDF and the on-screen module can never drift apart (I5).

import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import { parseBlocks, parseInline } from "@/app/lib/markdownBlocks";
import type { InlineRun } from "@/app/lib/markdownBlocks";
import type { ExportModule, RubricSection } from "./export";
import { parseRubric } from "./export";
import { formatAPA } from "@/src/lib/citation";
import { buildEssayRubric, generateEssayPromptHarness, isEssayPromptUsable, isEssayRubricUsable } from "@/src/lib/essay";
import { extractKeyConcepts } from "@/src/lib/concepts";

// Roboto is bundled in pdfmake's vfs; assign it once at module load.
pdfMake.vfs = pdfFonts;

const INDIGO = "#4338ca";
const MUTED = "#52525b";
const RULE = "#d4d4d8";
const INK = "#18181b";
const EXPORT_FOOTER_TEXT =
  "Diekspor dari So-study — bekal awal sebelum kuliah, bukan pengganti kuliah.";

function isoDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

/**
 * Cleans a comparison-table cell so a cell cut off mid-citation never reaches
 * the PDF as a dangling "[" (BUG 3). If the cell ends with an unclosed citation
 * marker we truncate at the last complete one and mark the loss with an
 * ellipsis — never a broken token, never mid-word.
 *
 * NOTE (BUG 4): the embedded Roboto font in this pdfmake version round-trips
 * `fi`/`fl` ligatures correctly on text extraction (verified by the regression
 * test in src/lib/pdf.test.ts), so no ligature-suppression hack is needed. A
 * zero-width-joiner insertion was attempted and rejected: under this pdfmake it
 * renders as a space yet the ligature glyph is still formed, which *lost* the
 * inner letter — strictly worse. The regression test guards the no-loss
 * invariant against future pdfmake upgrades.
 */
export function sanitizeCell(cell: string): string {
  let s = cell.replace(/\s*\[[^\]\n]*$/, "");
  s = s.replace(/[\s,;]+$/, "");
  if (s.length > 0 && s.length < cell.trim().length) s += "…";
  return s;
}

/**
 * Last line of defence for the student-facing PDF. A dangling open parenthesis
 * is the signature of a truncated concept fragment (e.g. "Aktor Selain Negara
 * (Non") — it can only reach here from data written BEFORE the concept
 * extractor was hardened (a stale `essayRubric` row in the database) or from a
 * caller that bypassed `extractKeyConcepts`. The current pipeline can never
 * produce it, but such a fragment must never be printed for the student to read
 * or print. Returns true when the string would render as visibly broken.
 */
export function hasUnbalancedParens(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return true;
    }
  }
  return depth !== 0;
}

// Clean fallback used when every guidance line is corrupted. It mirrors the
// deterministic harness rubric (src/lib/essay.ts) so a degraded worksheet still
// coaches the student instead of showing broken text.
const FALLBACK_GUIDANCE = [
  "Sebelum membuka sumber, ringkas modul ini dengan kata sendiri untuk menguji ingatan (recall).",
  "Susun bukti → analisis → kesimpulan; jawab kerangka 5W1H (Apa/Siapa/Kapan/Di mana/Mengapa/Bagaimana) untuk topik ini (penalaran).",
];

/** Drops corrupted guidance lines; falls back to a clean list when all are bad.
 *  Returns [] when no guidance was supplied, so callers preserve the original
 *  "no callout" behaviour instead of inventing a generic one. */
function safeStudyGuidance(guidance: string[] | undefined): string[] {
  if (!guidance?.length) return [];
  const clean = guidance.filter((g) => !hasUnbalancedParens(g));
  return clean.length ? clean : FALLBACK_GUIDANCE;
}

/** Maps inline markdown runs to pdfmake text fragments (strings or styled objects). */
function runsToFragments(runs: InlineRun[]): Array<string | Record<string, unknown>> {
  return runs.map((run) => {
    switch (run.kind) {
      case "bold":
        return { text: run.text, bold: true };
      case "italic":
        return { text: run.text, italics: true };
      case "code":
        return { text: run.text, font: "Roboto", fontSize: 9.5, background: "#f1f1f4" };
      case "link":
        return {
          text: [
            { text: run.text, color: "#1d4ed8", decoration: "underline" },
            { text: ` (${run.href})`, fontSize: 8, color: MUTED },
          ],
        };
      case "cite":
        // Keep the citation marker in the export so a printed PDF stays grounded
        // (I5 — an export must not launder a sourced module into an unsourced one).
        return { text: `[${run.n}]`, fontSize: 8, color: INDIGO };
      case "text":
      default:
        return run.text;
    }
  });
}

function rule(): Record<string, unknown> {
  return {
    canvas: [
      { type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: RULE },
    ],
    margin: [0, 6, 0, 6],
  };
}

/**
 * A framed callout: a thin indigo left bar + a soft tinted panel. Used for the
 * derived study-guidance block so it reads as a "how to study this" note rather
 * than module body. `title` is bold; `items` render as a tight checklist.
 */
function callout(title: string, items: string[]): Record<string, unknown> {
  return {
    table: {
      widths: [4, "*"],
      body: [
        [
          { text: "", fillColor: INDIGO },
          {
            margin: [12, 8, 12, 8],
            fillColor: "#f5f5fb",
            stack: [
              { text: title, style: "calloutTitle" },
              {
                ul: items.map((it) => ({ text: runsToFragments(parseInline(it)), style: "calloutItem" })),
                margin: [0, 2, 0, 0],
              },
            ],
          },
        ],
      ],
    },
    layout: "noBorders",
    margin: [0, 2, 0, 12],
  };
}

/** Renders parsed rubric sections as a structured, tickable checklist. */
function rubricToContent(sections: RubricSection[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const s of sections) {
    out.push({ text: `${s.letter}. ${s.title}`, style: "rubricHead" });
    out.push({
      ul: s.items.map((it) => ({ text: runsToFragments(parseInline(it)), style: "rubricItem" })),
    });
  }
  return out;
}

function heading(text: string, style: string): Record<string, unknown> {
  return { text: runsToFragments(parseInline(text)), style };
}

/**
 * A tinted callout box: a thin accent left bar + a soft tinted panel. Used to
 * visually separate "Contoh konkret" and "Pertanyaan refleksi" blocks from the
 * analytical prose above them, so a case study or a self-check prompt reads at a
 * glance as something different from body text (layout polish).
 */
function tintedBox(
  bodyRuns: Array<string | Record<string, unknown>>,
  accent: string,
  bg: string,
  bodyStyle?: string,
): Record<string, unknown> {
  return {
    table: {
      widths: [4, "*"],
      body: [
        [
          { text: "", fillColor: accent },
          {
            text: bodyRuns,
            style: bodyStyle ?? "p",
            fillColor: bg,
            margin: [12, 8, 12, 8],
          },
        ],
      ],
    },
    layout: "noBorders",
    margin: [0, 2, 0, 12],
  };
}

/**
 * Classifies a paragraph so case-study and reflection prompts can be rendered as
 * distinct callout boxes. The synthesis prompt instructs the model to start
 * those paragraphs with the cues below, so detection is deterministic rather
 * than a fuzzy substring scan.
 */
function paragraphKind(text: string): "example" | "reflection" | "normal" {
  const t = text
    .replace(/^[\d]+\.\s*/,'')
    .replace(/^[a-z]\.\s*/i,'')
    .replace(/^[-*]\s*/,'')
    .trim();
  if (/^contoh\s*konkret|^contoh\s*:|^ilustrasi\s*kasus/i.test(t)) return "example";
  if (/^pertanyaan\s*refleksi|^refleksi\s*:/i.test(t)) return "reflection";
  return "normal";
}

/** Builds the pdfmake content array from the module's markdown blocks. */
function blocksToContent(markdown: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  // Inside the "Konsep kunci & definisi" section we render each term (h3) as a
  // running head and its definition paragraph indented/smaller — a definition
  // list for quicker visual scanning (layout polish).
  let inKonsep = false;
  for (const b of parseBlocks(markdown)) {
    switch (b.type) {
      case "h1":
        out.push(heading(b.text, "h1"));
        break;
      case "h2":
        inKonsep = /konsep\s+kunci|konsep\s+utama|definisi/i.test(b.text);
        out.push(heading(b.text, "h2"));
        break;
      case "h3":
        out.push(heading(b.text, inKonsep ? "defTerm" : "h3"));
        break;
      case "h4":
        out.push(heading(b.text, "h4"));
        break;
      case "hr":
        out.push(rule());
        break;
      case "p": {
        const kind = paragraphKind(b.text);
        if (kind === "example") {
          out.push(tintedBox(runsToFragments(parseInline(b.text)), "#0f766e", "#ecfdf5", "exampleBody"));
        } else if (kind === "reflection") {
          out.push(tintedBox(runsToFragments(parseInline(b.text)), "#b45309", "#fffbeb", "reflectionBody"));
        } else {
          out.push({ text: runsToFragments(parseInline(b.text)), style: inKonsep ? "defBody" : "p" });
        }
        break;
      }
      case "quote":
        // Blockquote: a soft tinted panel + a thin indigo left bar so an
        // interpretation/quotation is visually set apart from body prose.
        out.push({
          table: {
            widths: [4, "*"],
            body: [
              [
                { text: "", fillColor: INDIGO },
                {
                  text: runsToFragments(parseInline(b.text)),
                  style: "quote",
                  fillColor: "#f6f6fb",
                },
              ],
            ],
          },
          layout: "noBorders",
          margin: [0, 2, 0, 10],
        });
        break;
      case "code":
        out.push({ text: b.code, style: "codeblock" });
        break;
      case "ul":
        out.push({ ul: b.items.map((it) => ({ text: runsToFragments(parseInline(it)) })) });
        break;
      case "ol":
        out.push({ ol: b.items.map((it) => ({ text: runsToFragments(parseInline(it)) })) });
        break;
      case "table": {
        const colCount = b.header.length;
        // A narrower first (dimension-label) column gives the data cells more
        // breathing room, which also reduces the chance of cells being cramped
        // (a contributor to mid-token truncation). Tables break across pages by
        // default, so a large comparison table flows cleanly onto the next page.
        let widths: string[] = b.header.map(() => "*");
        if (colCount === 2) widths = ["32%", "*"];
        else if (colCount === 3) widths = ["26%", "*", "*"];
        const body = [
          b.header.map((h) => ({
            text: runsToFragments(parseInline(sanitizeCell(h))),
            bold: true,
            fillColor: "#f4f4f5",
          })),
          ...b.rows.map((row) =>
            row.map((c) => ({ text: runsToFragments(parseInline(sanitizeCell(c))) })),
          ),
        ];
        out.push({ table: { headerRows: 1, widths, body }, margin: [0, 4, 0, 8] });
        break;
      }
    }
  }
  return out;
}

/**
 * The shared A4 document shell: page geometry, the style sheet, the running
 * header and the page footer. Both exports (reading PDF + worksheet PDF) render
 * through this one shell, so a typographic change can never apply to only one of
 * them — the split is a content split, never a styling fork.
 */
function renderPdf(
  topicTitle: string,
  courses: string,
  content: Array<Record<string, unknown>>,
): Promise<Uint8Array> {
  const docDefinition = {
    pageSize: "A4" as const,
    pageMargins: [40, 56, 40, 48],
    defaultStyle: { font: "Roboto", fontSize: 11, color: INK, lineHeight: 1.5 },
    styles: {
      title: { fontSize: 22, bold: true, margin: [0, 0, 0, 2], color: INK },
      h1: { fontSize: 17, bold: true, margin: [0, 16, 0, 5], color: INK },
      h2: { fontSize: 14, bold: true, margin: [0, 14, 0, 5], color: INDIGO },
      h3: { fontSize: 12.5, bold: true, margin: [0, 11, 0, 4], color: INDIGO },
      h4: { fontSize: 11.5, bold: true, margin: [0, 9, 0, 3], color: INK },
      p: { fontSize: 11, margin: [0, 0, 0, 9], alignment: "justify" },
      defTerm: { fontSize: 12, bold: true, color: INDIGO, margin: [0, 10, 0, 2] },
      defBody: { fontSize: 10.5, margin: [16, 0, 0, 8], alignment: "justify" },
      exampleBody: { fontSize: 10.5, margin: [0, 0, 0, 0] },
      reflectionBody: { fontSize: 10, margin: [0, 0, 0, 0], color: "#7c2d12" },
      quote: {
        fontSize: 10.5,
        italics: true,
        color: MUTED,
        margin: [12, 6, 12, 6],
        alignment: "left",
      },
      calloutTitle: { fontSize: 12, bold: true, color: INDIGO, margin: [0, 0, 0, 3] },
      calloutItem: { fontSize: 10.5, color: INK, margin: [0, 1, 0, 2] },
      rubricHead: { fontSize: 11.5, bold: true, color: INK, margin: [0, 6, 0, 2] },
      rubricItem: { fontSize: 10.5, color: INK, margin: [0, 1, 0, 3] },
      codeblock: {
        font: "Roboto",
        fontSize: 9,
        background: "#f1f1f4",
        margin: [8, 6, 8, 8],
      },
      meta: { fontSize: 9, color: MUTED },
      source: { fontSize: 10, margin: [0, 0, 0, 4] },
    },
    header: (currentPage: number) =>
      currentPage === 1
        ? undefined
        : { text: `${topicTitle}  ·  ${courses}`, style: "meta", margin: [40, 24, 40, 0] },
    footer: (currentPage: number, pageCount: number) => ({
      margin: [40, 0, 40, 20],
      columns: [
        { text: `So-study — ${topicTitle}`, style: "meta" },
        { text: `Halaman ${currentPage} dari ${pageCount}`, style: "meta", alignment: "right" },
      ],
    }),
    content,
  };

  return new Promise<Uint8Array>((resolve, reject) => {
    try {
      pdfMake.createPdf(docDefinition).getBuffer((buffer: Buffer) => resolve(new Uint8Array(buffer)));
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Renders a module to a PDF `Buffer`. The document carries real hierarchy
 * (title → section headings → body), comfortable long-form spacing, a running
 * header/footer with the title and page numbers, and a grounding sources
 * appendix so the PDF reads correctly even outside the app.
 *
 * READING MATERIAL ONLY: module body + sources. The essay question and the
 * rubric deliberately do NOT appear here — they are a separate, printable
 * download (`generateWorksheetPdf`, `?format=pdf-worksheet`), so the student can
 * print the exercise sheet to write on without reprinting ten pages of module,
 * and read the module without the assessment material interrupting it.
 */
export async function generatePdf(m: ExportModule): Promise<Uint8Array> {
  const courses = m.courseNames.length ? m.courseNames.join(", ") : "belum masuk mata kuliah";
  const meta = `${courses}  ·  dibuat ${isoDate(m.generatedAt)}`;

  const content: Array<Record<string, unknown>> = [
    { text: m.topicTitle, style: "title" },
    { text: meta, style: "meta" },
    rule(),
  ];

  // Derived study-guidance callout: frames recall/reasoning near the top so the
  // PDF itself coaches the student, not just displays the module. Guarded so a
  // corrupted (pre-fix) guidance line can never reach the printed page.
  if (m.studyGuidance?.length) {
    content.push(callout("Petunjuk belajar", safeStudyGuidance(m.studyGuidance)));
  }

  content.push(...blocksToContent(m.contentMarkdown));

  // A one-line pointer to the worksheet, so the split is discoverable from the
  // reading PDF itself instead of being a hidden second button.
  if (m.essayPrompt?.trim()) {
    content.push(rule());
    content.push({
      text: "Pertanyaan esai dan rubrik penilaian ada di unduhan terpisah: “Unduh lembar kerja (PDF)”.",
      style: "meta",
    });
  }

  // Grounding appendix: keeps the numbered `[n]` citations resolvable (I5).
  content.push(rule());
  content.push(heading("Sumber (grounding)", "h2"));
  if (m.sourcePapers.length === 0) {
    content.push({ text: "Modul ini belum mencatat paper sumber.", style: "p" });
  } else {
    m.sourcePapers.forEach((p, i) => {
      const citations =
        typeof p.citationCount === "number" && p.citationCount > 0
          ? ` — ${p.citationCount} sitasi`
          : "";
      // One APA-7 reference string (src/lib/citation.ts), re-parsed through the
      // shared inline markdown reader so its `*…*` runs (journal name / book
      // title) render as real italics here exactly as they do in the Markdown
      // export — the two exports cite identically (I5). The list number stays
      // bold and outside the reference so `[n]` remains resolvable; the citation
      // count is app metadata, so it stays small and muted.
      content.push({
        text: [
          { text: `${i + 1}. `, bold: true },
          ...runsToFragments(parseInline(formatAPA(p))),
          ...(citations ? [{ text: citations, fontSize: 9, color: MUTED }] : []),
        ],
        style: "source",
        margin: [0, 0, 0, 4],
      });
    });
  }

  content.push(rule());
  content.push({ text: EXPORT_FOOTER_TEXT, style: "meta", margin: [0, 0, 0, 0] });

  return renderPdf(m.topicTitle, courses, content);
}

/**
 * Renders the printable WORKSHEET PDF: the essay question, its 5W1H guidance,
 * and the rubric — deliberately WITHOUT the module body or the sources
 * appendix. The reading material (`generatePdf`) and the worksheet are now two
 * separate downloads so the student can print the exercise sheet alone (e.g.
 * to write on) while keeping the module on screen.
 */
export async function generateWorksheetPdf(m: ExportModule): Promise<Uint8Array> {
  const courses = m.courseNames.length ? m.courseNames.join(", ") : "belum masuk mata kuliah";
  const meta = `${courses}  ·  dibuat ${isoDate(m.generatedAt)}`;

  const content: Array<Record<string, unknown>> = [
    { text: m.topicTitle, style: "title" },
    { text: meta, style: "meta" },
    rule(),
  ];

  if (m.studyGuidance?.length) {
    content.push(callout("Petunjuk belajar", safeStudyGuidance(m.studyGuidance)));
  }

  // The essay prompt and rubric were stored at synthesis time and can be stale
  // or corrupted (e.g. a pre-fix row whose concept list atomised into section
  // headings like "Modul Belajar" / "Setelah membaca modul ini,"). When the
  // module actually has these (the student's worksheet always does), rebuild them
  // deterministically from the module's own synthesis text so a garbage stored
  // value can never reach the printed sheet.
  const concepts = m.keyConcepts?.length ? m.keyConcepts : extractKeyConcepts(m.contentMarkdown);
  const storedPrompt = m.essayPrompt?.trim() ?? "";
  const essayPrompt = storedPrompt && isEssayPromptUsable(storedPrompt, concepts)
    ? storedPrompt
    : generateEssayPromptHarness(m.contentMarkdown, m.topicTitle);

  if (storedPrompt) {
    content.push(heading("Pertanyaan esai (recall)", "h2"));
    content.push({ text: runsToFragments(parseInline(essayPrompt)), style: "p" });
    if (m.essayRubric?.trim()) {
      // Rubric: keep the stored one only when it actually cites this module's
      // real concepts; a corrupted (pre-fix) row that cited section-heading
      // fragments ("Modul Belajar") is rebuilt deterministically from the
      // module's real key concepts so garbage never reaches the printed sheet.
      const rubric = isEssayRubricUsable(m.essayRubric, concepts)
        ? m.essayRubric
        : buildEssayRubric(m.contentMarkdown);
      const rubricSections = parseRubric(rubric);
      content.push(rule());
      content.push(heading("Rubrik penilaian", "h3"));
      if (rubricSections.length) content.push(...rubricToContent(rubricSections));
      else content.push({ text: runsToFragments(parseInline(rubric.trim())), style: "p" });
    }
  } else {
    content.push({ text: "Modul ini belum memiliki pertanyaan esai.", style: "p" });
  }

  content.push(rule());
  content.push({ text: EXPORT_FOOTER_TEXT, style: "meta", margin: [0, 0, 0, 0] });

  return renderPdf(m.topicTitle, courses, content);
}
