// Module length verification + targeted expansion (harness-side, not prompt trust).
//
// The synthesis prompt asks Gemini for a ~10-page module, but prompt-only
// compliance is unreliable (same lesson as the essay-JSON bug): the model may
// stop short. So after generation we MEASURE the real word count and, if it is
// under the floor, we expand ONLY the thinnest per-concept subsection with a
// narrow second call — the harness does the diagnosis, the AI does a small,
// well-scoped completion. Consistent with the 90/10 approach used elsewhere:
// structure/measurement is deterministic, the model supplies content.

// ~500 words per printed A4 page at the module's current PDF typography
// (11pt Roboto, justified, 1.5 line-height, 40/48mm margins — see src/lib/pdf.ts).
import { isTableLine } from "@/app/lib/markdownBlocks";

export const WORDS_PER_PAGE = 500;
export const TARGET_PAGES = 10;
// 10 pages × 500 words, rounded up to leave a small margin above the floor.
export const MIN_WORDS = WORDS_PER_PAGE * TARGET_PAGES; // 5000

/** Word count of a markdown string (markup stripped of nothing structural; the
 * few heading words are noise compared to body prose and don't change the
 * pass/fail decision). */
export function countWords(markdown: string): number {
  const text = markdown.trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/** Given a word count, return the expected printed page count at the defined
 * words-per-page constant. Always at least 1 (never shows "0 halaman"). */
export function estimatePagesFromWords(wordCount: number): number {
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_PAGE));
}

export interface Subsection {
  level: 2 | 3;
  heading: string;
  /** Body + heading span in the original markdown. */
  start: number;
  end: number;
  wordCount: number;
}

// Headings that belong to the structural scaffold (Gagné sections 1, 2, 5, 6, 7
// and the section-3 container) are intentionally short and must NOT be picked
// as "thinnest" — we only want to expand the per-concept subsections.
const STRUCTURAL_HEADING = /(tujuan pembelajaran|penting|konsep kunci|perbandingan|rangkuman|ringkasan|daftar istilah|glosarium|glossary)/i;

/** Split markdown into level-2/level-3 subsections with their span + word count. */
export function splitSubsections(markdown: string): Subsection[] {
  const re = /^#{2,3}\s+(.*)$/gm;
  const matches: { level: 2 | 3; heading: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const prefix = m[0].slice(0, m[0].indexOf(" "));
    matches.push({
      level: (prefix.length === 2 ? 2 : 3) as 2 | 3,
      heading: m[1].trim(),
      index: m.index,
    });
  }
  const out: Subsection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    const body = markdown.slice(cur.index, end);
    out.push({
      level: cur.level,
      heading: cur.heading,
      start: cur.index,
      end,
      wordCount: countWords(body),
    });
  }
  return out;
}

/** The per-concept subsection (non-structural) with the fewest words, or null. */
export function findThinnestSubsection(markdown: string): Subsection | null {
  const candidates = splitSubsections(markdown).filter(
    (s) => !STRUCTURAL_HEADING.test(s.heading),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((min, s) => (s.wordCount < min.wordCount ? s : min));
}

/** Replace a subsection's span (from its heading through its body) with new text. */
export function replaceSubsection(
  markdown: string,
  sub: Subsection,
  newContent: string,
): string {
  return markdown.slice(0, sub.start) + newContent.trim() + "\n\n" + markdown.slice(sub.end);
}

/** Build the system prompt for a targeted expansion call (reuses the same
 * disciplinary framing as the main synthesis so the expansion matches voice). */
export function buildExpansionSystem(courseName: string, major?: string): string {
  return `Kamu adalah asisten penyusun modul belajar untuk mata kuliah "${courseName}".${
    major
      ? `\nJurusan (disiplin) mahasiswa: "${major}". Tulis MELALUI lensa disiplin ${major}.`
      : ""
  }
Tugasmu: ekspansi TERPUSAT dari modul yang sudah ada, bukan menulis ulang. Gunakan HANYA informasi dari paper yang diberikan. Pertahankan Bahasa Indonesia dan gaya penulisan asli.`;
}

/** Build a narrow prompt that asks Gemini to expand ONE subsection only. */
export function buildExpansionPrompt(
  heading: string,
  corpus: string,
  title: string,
): string {
  return `Topik minggu ini: ${title}

Korpus sumber (GUNAKAN HANYA teks ini, jangan pakai pengetahuan lain):
${corpus}

Tugas: ekspansi TERPUSAT dan TAMBAHAN — JANGAN tulis ulang seluruh modul, dan JANGAN ubah bagian lain.
Perluas HANYA bagian berikut yang terlalu ringkas:
"${heading}"

Tambahkan kedalaman (penjelasan lebih dari sumber dengan sitasi [n]), SATU contoh konkret/ilustrasi kasus yang bekerja, dan 1–2 pertanyaan refleksi singkat (tidak dinilai) di akhir bagian. Keluarkan SELURUH bagian tersebut — mulai dengan heading yang SAMA ("${heading}") — dalam Bahasa Indonesia, siap disisipkan menggantikan bagian aslinya.`;
}

export interface ExpandGenerateFn {
  (opts: {
    system: string;
    prompt: string;
    maxOutputTokens?: number;
  }): Promise<{ text: string }>;
}

export interface ExpandContext {
  system: string;
  corpus: string;
  title: string;
  maxPasses?: number;
  /** Max passes spent repairing truncation + appending missing sections. */
  maxCompletenessPasses?: number;
}

export interface ExpandResult {
  finalText: string;
  passes: number;
  metFloor: boolean;
  wordCount: number;
  pageCount: number;
  /** True when all required synthesis sections are present and the tail is clean. */
  complete: boolean;
}

/**
 * The seven sections the synthesis spec requires, in order. Section completeness
 * is checked INDEPENDENTLY of the word-count floor: a module can hit the page
 * floor yet still be missing Rangkuman bab / Daftar istilah kunci if generation
 * was cut off mid-stream (which is also what produces a truncated comparison
 * table). We verify the structure first, then length.
 */
export const REQUIRED_SECTIONS: { key: string; pattern: RegExp }[] = [
  { key: "tujuan", pattern: /tujuan\s+pembelajaran/i },
  { key: "penting", pattern: /mengapa.*penting|penting/i },
  { key: "konsep", pattern: /konsep\s+kunci|konsep\s+utama|definisi/i },
  { key: "perbandingan", pattern: /perbandingan|kontras/i },
  { key: "rangkuman", pattern: /rangkuman\s+bab|rangkuman/i },
  { key: "glosarium", pattern: /daftar\s+istilah|glosarium|glossary/i },
];

/** Returns the keys of required sections absent from the module markdown. */
export function findMissingSections(markdown: string): string[] {
  const lower = markdown.toLowerCase();
  return REQUIRED_SECTIONS.filter((s) => !s.pattern.test(lower)).map((s) => s.key);
}

/**
 * Detects a module cut off mid-stream: the text ends with an unclosed citation
 * marker ("[" with no "]") — the exact failure that produced a comparison-table
 * cell ending "...komunikasi tim [1], [7], [9], [".
 */
export function detectTruncatedTail(markdown: string): boolean {
  const trimmed = markdown.replace(/\s+$/, "");
  if (/[\s,;]*\[[^\]\n]*$/.test(trimmed)) return true;
  // Last non-empty line is a pipe table row that is neither a delimiter nor a
  // heading — i.e. the table itself was sliced in half.
  const lastLine = trimmed.split("\n").pop() ?? "";
  if (
    lastLine.includes("|") &&
    !/^\s*\|?[\s\-:|]+\|?\s*$/.test(lastLine) &&
    !/^#{1,6}\s/.test(lastLine)
  ) {
    return true;
  }
  return false;
}

/** Number of leading lines to keep when dropping a truncated tail. */
function cleanCutLineCount(t: string): number {
  const lines = t.split("\n");
  // If the tail sits inside a table, cut at the line just before that table so
  // we regenerate the whole comparison block (plus whatever follows) cleanly.
  let tableStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isTableLine(lines[i])) {
      let j = i;
      while (j - 1 >= 0 && isTableLine(lines[j - 1])) j--;
      tableStart = j;
      while (i < lines.length && isTableLine(lines[i])) i++;
    }
  }
  if (tableStart > 0) return tableStart;
  // Otherwise keep everything up to the last heading.
  let lastHeading = -1;
  for (let i = 0; i < lines.length; i++) if (/^#{1,6}\s+/.test(lines[i])) lastHeading = i;
  return lastHeading > 0 ? lastHeading : Math.max(0, lines.length - 1);
}

function sectionLabel(key: string): string {
  switch (key) {
    case "tujuan":
      return "Tujuan Pembelajaran";
    case "penting":
      return "Mengapa topik ini penting";
    case "konsep":
      return "Konsep kunci & definisi";
    case "perbandingan":
      return "Perbandingan/kontras antar konsep";
    case "rangkuman":
      return "Rangkuman bab";
    case "glosarium":
      return "Daftar istilah kunci (glosarium)";
    default:
      return key;
  }
}

/** Prompt to continue a module that was cut off mid-stream. */
function buildContinuePrompt(prefix: string, corpus: string, title: string): string {
  return `Topik minggu ini: ${title}

Korpus sumber (GUNAKAN HANYA teks ini, jangan pakai pengetahuan lain):
${corpus}

Modul terpotong di tengah. Berikut bagian AWAL yang sudah benar (JANGAN ubah):
"""
${prefix.slice(-4000)}
"""

Tugas: LANJUTKAN dan SELESAIKAN modul dari bagian terakhir di atas. Pastikan tabel perbandingan (jika ada) selesai dengan seluruh sel tertutup rapi (tidak ada "[" yang menggantung), lalu tambahkan bagian "Rangkuman bab" dan "Daftar istilah kunci (glosarium)" jika belum ada. Keluarkan kelanjutan modul dalam Bahasa Indonesia, tanpa mengulang bagian yang sudah ada.`;
}

/** Prompt to append only the sections still missing from a partial module. */
function buildMissingSectionsPrompt(
  missing: string[],
  corpus: string,
  title: string,
  existing: string,
): string {
  return `Topik minggu ini: ${title}

Korpus sumber (GUNAKAN HANYA teks ini, jangan pakai pengetahuan lain):
${corpus}

Modul berikut SUDAH sebagian lengkap:
"""
${existing.slice(0, 6000)}
"""

Tugas: TULISKAN HANYA bagian yang MASIH KURANG dari modul di atas, yaitu (urutan):
${missing.map((m) => `- ${sectionLabel(m)}`).join("\n")}

Gunakan heading "##" yang sama dengan modul. Sertakan sitasi [n] dari korpus bila relevan. Keluarkan SELURUH bagian yang kurang, siap disisipkan di akhir modul. JANGAN tulis ulang bagian yang sudah ada.`;
}

/**
 * Stage 1 of the harness: guarantee SECTION COMPLETENESS, independent of and
 * prior to the word-count check. If the module was cut off mid-stream we repair
 * the tail; then we append any still-missing required sections. Bounded by
 * `maxCompletenessPasses` so it can never loop forever. Only runs when the text
 * already looks like a module (≥1 required section present) — arbitrary/placeholder
 * text is left untouched.
 */
async function ensureComplete(
  initialText: string,
  generate: ExpandGenerateFn,
  ctx: ExpandContext,
): Promise<{ text: string; passes: number; complete: boolean }> {
  const lower = initialText.toLowerCase();
  const present = REQUIRED_SECTIONS.filter((s) => s.pattern.test(lower)).length;
  if (present === 0) return { text: initialText, passes: 0, complete: false };

  const maxPasses = ctx.maxCompletenessPasses ?? 3;
  let text = initialText;
  let passes = 0;
  while (passes < maxPasses) {
    if (detectTruncatedTail(text)) {
      const keep = cleanCutLineCount(text);
      const prefix = text.split("\n").slice(0, keep).join("\n");
      const out = await generate({
        system: ctx.system,
        prompt: buildContinuePrompt(prefix, ctx.corpus, ctx.title),
        maxOutputTokens: 4096,
      });
      text = (prefix.replace(/\s+$/, "") + "\n\n" + out.text.trim());
      passes++;
      continue;
    }
    const missing = findMissingSections(text);
    if (missing.length === 0) break;
    const out = await generate({
      system: ctx.system,
      prompt: buildMissingSectionsPrompt(missing, ctx.corpus, ctx.title, text),
      maxOutputTokens: 4096,
    });
    text = (text.replace(/\s+$/, "") + "\n\n" + out.text.trim());
    passes++;
  }
  return {
    text,
    passes,
    complete: findMissingSections(text).length === 0 && !detectTruncatedTail(text),
  };
}

/**
 * Deterministically drives the module up to the page floor. Measures the real
 * word count, and while under the floor and within `maxPasses` (default 2),
 * expands the single thinnest per-concept subsection with a narrow call. Each
 * pass re-diagnoses (the previously-thinnest may now be the thickest), so the
 * loop is bounded and cheap. Returns what it has if still short after 2 passes
 * — the caller surfaces a non-blocking "ringkas" note rather than pretending.
 */
export async function expandModuleUntilFloor(
  initialText: string,
  generate: ExpandGenerateFn,
  ctx: ExpandContext,
): Promise<ExpandResult> {
  const maxPasses = ctx.maxPasses ?? 2;

  // Stage 1 — section completeness, verified BEFORE and independent of length.
  const complete = await ensureComplete(initialText, generate, ctx);

  // Stage 2 — word-count floor (only now, on a structurally complete module).
  let text = complete.text;
  let lengthPasses = 0;
  while (lengthPasses < maxPasses && countWords(text) < MIN_WORDS) {
    const thin = findThinnestSubsection(text);
    if (!thin) break; // nothing expandable left; ship as-is
    const out = await generate({
      system: ctx.system,
      prompt: buildExpansionPrompt(thin.heading, ctx.corpus, ctx.title),
      maxOutputTokens: 4096,
    });
    text = replaceSubsection(text, thin, out.text);
    lengthPasses++;
  }
  const wordCount = countWords(text);
  return {
    finalText: text,
    passes: complete.passes + lengthPasses,
    metFloor: wordCount >= MIN_WORDS,
    wordCount,
    pageCount: estimatePagesFromWords(wordCount),
    complete: complete.complete,
  };
}
