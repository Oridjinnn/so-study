// Module export — pure formatters, no DB and no framework imports (I1/I3).
//
// Roadmap Phase 3 "Export module → PDF / MD / Anki". Splitting the *formatting*
// out of the route keeps it unit-testable (G10) and keeps the route down to
// fetch → format → stream.
//
// Formats:
//   - `md`   Markdown: the module plus a grounding appendix (sources with URLs)
//            and the generated essay prompt/rubric. Portable, diff-able, and
//            still carries its citations (I5 — an export must not launder a
//            grounded module into an unsourced one).
//   - `anki` Tab-separated notes for Anki's text importer, with the file
//            directives Anki 2.1.55+ reads (`#separator:tab`, `#html:true`).
//   - `pdf`   A real, server-generated PDF (see `src/lib/pdf.ts`), so the
//            export is a downloadable file rather than the browser's native
//            print dialog — which hides "Save as PDF" behind a pinch gesture
//            on iPad Safari.

import { slugifyHeading } from "@/app/lib/study";
import { analyzeModuleContent, deriveStudyGuidance } from "@/app/lib/pdfExtract";
import { formatAPA } from "./citation";
import type { PaperType } from "./sources/types";

export type ExportFormat = "md" | "anki" | "pdf";

/**
 * A structured, enum-lettered section of the essay rubric (A. Penulisan …,
 * B. Penafsiran …, etc). The PDF renders these as a checklist rather than flat
 * prose so the student can tick criteria off while writing (penulisan).
 */
export interface RubricSection {
  letter: string;
  title: string;
  items: string[];
}

export interface ExportPaper {
  title: string;
  authors: string;
  year: number;
  sourceUrl: string;
  citationCount?: number;
  // Bibliographic metadata for the APA-7 reference (src/lib/citation.ts).
  // All optional and nullable: they mirror nullable Prisma columns that older
  // rows (retrieved before the columns existed) simply do not have, and a
  // reference still renders from title/authors/year alone.
  doi?: string | null;
  venue?: string | null;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  publisher?: string | null;
  type?: PaperType | null;
}

export interface ExportModule {
  topicTitle: string;
  courseNames: string[];
  generatedAt: string | Date;
  contentMarkdown: string;
  sourcePapers: ExportPaper[];
  essayPrompt?: string | null;
  essayRubric?: string | null;
  /** Derived study-guidance bullets (recall/reasoning framing) for the PDF. */
  studyGuidance?: string[];
  /** Derived key concepts captured from the module's own structure. */
  keyConcepts?: string[];
  /** Derived key arguments/claims captured from the module's own structure. */
  keyArguments?: string[];
  /** Derived, structured essay-rubric sections when present. */
  rubricSections?: RubricSection[];
}

export interface ExportCard {
  stem: string;
  options: string[];
  answer: string;
  explanation?: string | null;
}

/** Framing that must survive every export (roadmap §3 non-goal). */
export const EXPORT_FOOTER =
  "Diekspor dari So-study — bekal awal sebelum kuliah, bukan pengganti kuliah.";

function isoDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

/**
 * Splits the harness-built essay rubric (`buildEssayRubric`) into structured
 * sections keyed by their `A.`–`D.` letter, so the PDF can render a real
 * checklist instead of flat prose. Wrapped, indented continuation lines are
 * merged back into the bullet above them. If the text has no enum sections the
 * caller falls back to rendering it verbatim.
 */
export function parseRubric(rubric: string): RubricSection[] {
  const sections: RubricSection[] = [];
  let current: RubricSection | null = null;
  let itemBuf = "";

  const flushItem = () => {
    if (current && itemBuf.trim()) current.items.push(itemBuf.trim());
    itemBuf = "";
  };

  for (const line of rubric.replace(/\r\n/g, "\n").split("\n")) {
    const section = line.match(/^\s*([A-E])\.\s*([^:]+):\s*$/);
    if (section) {
      flushItem();
      if (current) sections.push(current);
      current = { letter: section[1], title: section[2].trim(), items: [] };
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*\S)\s*$/);
    if (bullet) {
      flushItem();
      itemBuf = bullet[1];
    } else if (
      current &&
      line.trim() &&
      /^\s+\S/.test(line) &&
      !/^\s*[A-E]\./.test(line)
    ) {
      // Indented continuation of the current bullet (e.g. a long criterion).
      itemBuf += " " + line.trim();
    } else {
      flushItem();
    }
  }
  flushItem();
  if (current) sections.push(current);
  return sections;
}

/**
 * Populates the derived `ExportModule` fields the PDF consumes
 * (`studyGuidance`, `keyConcepts`, `keyArguments`, `rubricSections`) from the
 * module's own content. Keeps the export honest: the harness reads the real
 * structure instead of echoing raw text (penafsiran).
 */
export function enrichModule(m: ExportModule): ExportModule {
  const analysis = analyzeModuleContent(m.contentMarkdown);
  return {
    ...m,
    studyGuidance: deriveStudyGuidance(analysis, m.essayPrompt),
    keyConcepts: analysis.keyConcepts,
    keyArguments: analysis.keyArguments,
    rubricSections: m.essayRubric?.trim() ? parseRubric(m.essayRubric) : [],
  };
}

/**
 * Markdown export: header metadata, the module itself, the auto-generated
 * essay prompt/rubric when present, then a numbered source list whose order
 * matches the module's inline `[n]` citations. Each entry is a real APA-7
 * reference (`src/lib/citation.ts`), so the appendix can be pasted into an
 * essay bibliography instead of retyped.
 */
export function toMarkdown(m: ExportModule): string {
  const courses = m.courseNames.length
    ? m.courseNames.join(", ")
    : "belum masuk mata kuliah";

  const parts: string[] = [
    `# ${m.topicTitle}`,
    "",
    `- Mata kuliah: ${courses}`,
    `- Modul dibuat: ${isoDate(m.generatedAt)}`,
    "",
    "---",
    "",
    m.contentMarkdown.trim(),
  ];

  if (m.essayPrompt?.trim()) {
    parts.push("", "---", "", "## Pertanyaan esai (recall)", "", m.essayPrompt.trim());
    if (m.essayRubric?.trim()) {
      parts.push("", "### Rubrik penilaian", "", m.essayRubric.trim());
    }
  }

  parts.push("", "---", "", "## Sumber (grounding)", "");
  if (m.sourcePapers.length === 0) {
    parts.push("_Modul ini belum mencatat paper sumber._");
  } else {
    m.sourcePapers.forEach((p, i) => {
      // The list number is the module's inline `[n]` marker, so it stays outside
      // the APA reference; the citation count is app metadata, not part of the
      // citation, so it trails behind it (and only when actually known).
      const citations =
        typeof p.citationCount === "number" && p.citationCount > 0
          ? ` — ${p.citationCount} sitasi`
          : "";
      parts.push(`${i + 1}. ${formatAPA(p)}${citations}`);
    });
  }

  parts.push("", "---", "", EXPORT_FOOTER, "");
  return parts.join("\n");
}

/** Anki fields are HTML when `#html:true`, so escape before inserting markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Flattens a field for a tab-separated row: tabs would start a new column and
 * newlines a new note, so both are neutralised (newlines become `<br>`).
 */
function ankiField(text: string): string {
  return escapeHtml(text)
    .replace(/\t/g, "    ")
    .replace(/\r\n|\r|\n/g, "<br>")
    .trim();
}

const OPTION_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** Anki deck/tag names treat `::` as nesting, so keep the title on one level. */
function ankiDeckName(topicTitle: string): string {
  const clean = topicTitle.replace(/[:\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return `So-study::${clean || "Modul"}`;
}

/**
 * Anki text import: one note per card, `front<TAB>back`. Front = stem + labelled
 * options; back = the correct option plus its explanation, so a card still
 * teaches when reviewed months later.
 */
export function toAnkiTSV(cards: ExportCard[], topicTitle: string): string {
  const tag = slugifyHeading(topicTitle) || "modul";
  const lines: string[] = [
    "#separator:tab",
    "#html:true",
    "#notetype:Basic",
    `#deck:${ankiDeckName(topicTitle)}`,
    `#tags:so-study ${tag}`,
  ];

  for (const card of cards) {
    const options = card.options
      .map((opt, i) => `${OPTION_LABELS[i] ?? i + 1}. ${ankiField(opt)}`)
      .join("<br>");
    const front = options
      ? `${ankiField(card.stem)}<br><br>${options}`
      : ankiField(card.stem);

    let back = `Jawaban: ${ankiField(card.answer)}`;
    if (card.explanation?.trim()) {
      back += `<br><br>${ankiField(card.explanation)}`;
    }
    lines.push(`${front}\t${back}`);
  }

  return lines.join("\n") + "\n";
}

const EXTENSIONS: Record<ExportFormat, string> = { md: "md", anki: "tsv", pdf: "pdf" };

const CONTENT_TYPES: Record<ExportFormat, string> = {
  md: "text/markdown; charset=utf-8",
  anki: "text/tab-separated-values; charset=utf-8",
  pdf: "application/pdf",
};

/** Narrows an untrusted `?format=` query value. */
export function parseExportFormat(value: string | null | undefined): ExportFormat | null {
  return value === "md" || value === "anki" || value === "pdf" ? value : null;
}

export function contentTypeFor(format: ExportFormat): string {
  return CONTENT_TYPES[format];
}

/** Deterministic, ASCII-safe download name: `so-study-<topic-slug>.<ext>`. */
export function exportFilename(topicTitle: string, format: ExportFormat): string {
  const slug = slugifyHeading(topicTitle) || "modul";
  return `so-study-${slug}.${EXTENSIONS[format]}`;
}
