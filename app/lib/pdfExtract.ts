/**
 * Module-content analysis harness for export (distinct from the uploaded-PDF
 * text extractor below). Given a module's own `contentMarkdown`, it pulls the
 * concepts / arguments / citations that the PDF export should surface so the
 * export reflects a *real* reading of the module (penafsiran) rather than a
 * raw text dump. Pure and dependency-free: it reuses the shared markdown AST
 * parser so it can never drift from the on-screen reader (I5).
 */
import { parseBlocks, parseInline } from "./markdownBlocks";

export interface ModuleAnalysis {
  /** Short concept terms drawn from a "Konsep kunci"/"Definisi" section. */
  keyConcepts: string[];
  /** Claim/argument lines and blockquotes drawn from an "Argumen" section. */
  keyArguments: string[];
  /** Highest inline `[n]` citation number used in the module body. */
  citationCount: number;
}

const CONCEPT_SECTION = /konsep|definisi|istilah/;
const ARGUMENT_SECTION = /argumen|klaim|teori/;
const STOP_WORDS = /^(dan|atau|dengan|yang)$/i;

/** Collapses a line to its leading concept term (before ":", "adalah", …). */
function shortConcept(line: string): string | null {
  const clean = line.replace(/^[#*\s>\-]+/, "").trim();
  if (!clean) return null;
  const concept = clean
    .split(/:\s*|\s?-\s*|\s?–\s*|(?:adalah|merupakan|ialah)\s/i)[0]
    .trim();
  const short = concept.split(/\s+/).slice(0, 4).join(" ").trim();
  return short.length >= 3 && !STOP_WORDS.test(short) ? short : null;
}

/** Walks the module's own structure to capture what the student must interpret. */
export function analyzeModuleContent(markdown: string): ModuleAnalysis {
  const blocks = parseBlocks(markdown);
  const keyConcepts: string[] = [];
  const keyArguments: string[] = [];
  let citationCount = 0;

  for (const b of blocks) {
    if ("text" in b) {
      for (const run of parseInline(b.text)) {
        if (run.kind === "cite") citationCount = Math.max(citationCount, run.n);
      }
    }
  }

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== "h1" && b.type !== "h2" && b.type !== "h3" && b.type !== "h4") continue;
    const heading = b.text.toLowerCase();
    const isConcept = CONCEPT_SECTION.test(heading);
    const isArgument = ARGUMENT_SECTION.test(heading);
    if (!isConcept && !isArgument) continue;

    for (let j = i + 1; j < blocks.length; j++) {
      const nxt = blocks[j];
      if (nxt.type === "h1" || nxt.type === "h2" || nxt.type === "h3" || nxt.type === "h4") break;
      if (nxt.type === "ul" || nxt.type === "ol") {
        for (const it of nxt.items) {
          if (isConcept) {
            const c = shortConcept(it);
            if (c && keyConcepts.length < 6 && !keyConcepts.includes(c)) keyConcepts.push(c);
          } else if (isArgument) {
            const a = it.trim();
            if (a && keyArguments.length < 6 && !keyArguments.includes(a)) keyArguments.push(a);
          }
        }
      } else if (nxt.type === "quote") {
        if (isArgument && keyArguments.length < 6) keyArguments.push(nxt.text.trim());
      } else if (nxt.type === "p" && isConcept) {
        const c = shortConcept(nxt.text);
        if (c && keyConcepts.length < 6 && !keyConcepts.includes(c)) keyConcepts.push(c);
      }
    }
  }

  return { keyConcepts, keyArguments, citationCount };
}

/**
 * Derives a concise, module-specific study-guidance list that frames recall
 * and reasoning (penalaran) — never generic marketing copy. Each bullet is
 * grounded in what the analysis actually found in the module.
 */
export function deriveStudyGuidance(
  analysis: ModuleAnalysis,
  essayPrompt?: string | null,
): string[] {
  const guidance: string[] = [];
  if (analysis.keyConcepts.length) {
    guidance.push(
      `Sebelum membuka sumber, coba jelaskan dengan kata sendiri: ${analysis.keyConcepts.join(", ")}.`,
    );
  } else {
    guidance.push(
      "Sebelum membuka sumber, ringkas modul ini dengan kata sendiri untuk menguji ingatan (recall).",
    );
  }
  if (analysis.citationCount > 0) {
    guidance.push(
      `Untuk tiap sitasi [1]–[${analysis.citationCount}], tuliskan apa yang sebenarnya diklaim sumber — bukan sekadar mengutip (penafsiran).`,
    );
  }
  guidance.push(
    "Susun bukti → analisis → kesimpulan; jawab kerangka 5W1H (Apa/Siapa/Kapan/Di mana/Mengapa/Bagaimana) untuk topik ini (penalaran).",
  );
  if (essayPrompt?.trim()) {
    guidance.push(
      "Gunakan pertanyaan esai dan rubrik di bawah sebagai latihan menulis (penulisan) sebelum menyerahkan.",
    );
  }
  return guidance;
}

/**
 * Extract plain text from a PDF the student uploaded themselves.
 *
 * Assist-only: the caller is expected to surface the returned text for the
 * student to review/edit before committing it — never auto-submit it as the
 * official RPS order (this keeps the human-approval principle from the
 * paper-review flow). No fetching from any external source: the student
 * supplies the file (e.g. a downloadable kalender akademik / RPS document),
 * this module only reads what is handed to it.
 *
 * `pdf-parse` is imported lazily so it is code-split out of the initial bundle
 * and the parser is only loaded when a PDF is actually chosen.
 */
export async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
