// Shared, framework-free markdown parsing for module content.
//
// Both the in-app reader (`app/lib/markdown.tsx`) and the server-side PDF
// exporter (`src/lib/pdf.ts`) need to turn `contentMarkdown` into a structured
// representation. Keeping the *parser* in one place means the reader and the
// exported PDF can never drift apart (I5 — an export must not launder a
// grounded module into a differently-structured one).

/**
 * Module text is LLM output, so a `javascript:`/`data:` href would be an
 * injection vector: only navigable schemes (and in-document links) survive.
 */
export function safeHref(url: string): string | null {
  return /^(?:https?:\/\/|mailto:|\/|#)/i.test(url) ? url : null;
}

// Ordered alternation: the `[text](url)` link must be tried before the `[n]`
// citation, otherwise `[2](https://…)` would be read as citation 2.
export const INLINE_RE =
  /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\[(\d+)\])/g;

export type InlineRun =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string }
  | { kind: "cite"; n: number };

/**
 * Parses inline spans (bold / italic / code / links / citations) into an
 * ordered list of styled runs. Returns plain `InlineRun`s — no React, no
 * pdfmake — so both the reader and the PDF exporter can map them to their own
 * node type.
 */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = new RegExp(INLINE_RE);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[2] !== undefined) {
      runs.push({ kind: "bold", text: m[2] });
    } else if (m[3] !== undefined) {
      runs.push({ kind: "italic", text: m[3] });
    } else if (m[4] !== undefined) {
      runs.push({ kind: "code", text: m[4] });
    } else if (m[5] !== undefined && m[6] !== undefined) {
      const href = safeHref(m[6]);
      if (href) runs.push({ kind: "link", text: m[5], href });
      else runs.push({ kind: "text", text: m[5] });
    } else if (m[7] !== undefined) {
      runs.push({ kind: "cite", n: Number(m[7]) });
    }
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ kind: "text", text: text.slice(last) });
  return runs;
}

export type Block =
  | { type: "h1" | "h2" | "h3" | "h4"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "hr" };

/** A GFM pipe row: starts with `|` and has at least one more separator. */
export function isTableLine(line: string | undefined): boolean {
  if (line === undefined) return false;
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.indexOf("|", 1) > 0;
}

export function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function isDelimiterRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

/** ```lang … ``` — the closing fence is optional (streamed output can be cut). */
export function parseFence(lines: string[], start: number): [Block, number] {
  const lang = lines[start].slice(3).trim();
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && !lines[i].startsWith("```")) {
    body.push(lines[i]);
    i++;
  }
  return [{ type: "code", lang: lang || undefined, code: body.join("\n") }, i + 1];
}

/** Pipe table; the `| --- |` separator row is optional (models often skip it). */
export function parseTable(lines: string[], start: number): [Block, number] {
  const rows: string[][] = [];
  let i = start;
  while (i < lines.length && isTableLine(lines[i])) {
    const cells = splitRow(lines[i]);
    if (!isDelimiterRow(cells)) rows.push(cells);
    i++;
  }
  const [header = [], ...body] = rows;
  return [{ type: "table", header, rows: body }, i];
}

/** A paragraph runs until a blank line or the start of any other block. */
export function startsBlock(line: string): boolean {
  return (
    line.startsWith("#") ||
    line.startsWith(">") ||
    line.startsWith("- ") ||
    line.startsWith("* ") ||
    line.startsWith("```") ||
    isTableLine(line) ||
    /^(\d+)\.\s/.test(line) ||
    line.trim() === "---"
  );
}

export type HeadingLevel = "h1" | "h2" | "h3" | "h4";

// Longest prefix first: "## " must not swallow "##### ".
export const HEADINGS: [string, HeadingLevel][] = [
  ["##### ", "h4"],
  ["#### ", "h4"],
  ["### ", "h3"],
  ["## ", "h2"],
  ["# ", "h1"],
];

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = HEADINGS.find(([prefix]) => line.startsWith(prefix));
    if (heading) {
      blocks.push({ type: heading[1], text: line.slice(heading[0].length) });
      i++;
      continue;
    }
    if (line.trim() === "---") {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const [block, next] = parseFence(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    if (isTableLine(line)) {
      const [block, next] = parseTable(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    if (line.startsWith("> ")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        buf.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: "quote", text: buf.join(" ") });
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const buf: string[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) {
        buf.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: "ul", items: buf });
      continue;
    }
    if (/^(\d+)\.\s/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^(\d+)\.\s/.test(lines[i])) {
        buf.push(lines[i].replace(/^(\d+)\.\s/, ""));
        i++;
      }
      blocks.push({ type: "ol", items: buf });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "p", text: buf.join(" ") });
  }
  return blocks;
}
