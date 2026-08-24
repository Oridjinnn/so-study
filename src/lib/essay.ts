// Essay question generation — the ONE legitimate AI call in the essay pipeline
// (Change A: ~90% harness / 10% AI). The rubric is built deterministically by
// `buildEssayRubric` from the module's own structure, so only the open-ended
// 5W1H essay question still needs generation. Generation is schema-validated
// (zod) instead of trusting ad-hoc `typeof` checks, and on malformed output it
// logs the failure and retries once with a stricter instruction before giving up.

import { z } from "zod";
import { generate, type GeminiUsage } from "./gemini";
import { logAIUsage } from "./aiusage";
import { extractKeyConcepts as extractModuleConcepts } from "./concepts";

const EssayPromptSchema = z.object({ prompt: z.string().min(1) });

// Whitespace / markdown-fence noise around the JSON object.
function stripFences(text: string): string {
  return text
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
}

type TryResult = { prompt: string; usage: GeminiUsage } | { failed: true; usage: GeminiUsage };

type EssayAnchors = {
  topic: string;
  concepts: string[];
  theories: string[];
  sources: string[];
};

// Pull concrete, module-specific anchors out of the synthesis text so the AI
// call can ground the question in THIS module instead of a generic template.
//
// `topicTitle` is the real module/topic title supplied by the caller (the
// authoritative source). When present it is used as-is — the module body's
// first heading is a SECTION HEADING (e.g. "Tujuan Pembelajaran"), NOT the
// title, so deriving the title from the body is exactly the bug that produced
// `Tulis esai berdasarkan modul "Tujuan Pembelajaran"`. We only fall back to
// scanning the body when no title is supplied.
function deriveAnchors(content: string, topicTitle?: string): EssayAnchors {
  const lines = content.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());

  let topic = topicTitle?.trim() ?? "";
  if (!topic) {
    for (const l of lines) {
      const m =
        l.match(/^\s*#{1,6}\s*MODUL[:\s]*(.+?)\s*$/i) ||
        l.match(/^\s*MODUL[:\s]*(.+?)\s*$/i) ||
        l.match(/^\s*#{1,6}\s*(.+?)\s*$/i);
      if (m && m[1]) {
        topic = m[1].replace(/^[:\-\s]+/, "").slice(0, 80).trim();
        break;
      }
    }
  }

  const concepts = extractKeyConcepts(content);
  const theories = lines
    .filter((l) => /(^|[^a-z])teori([^a-z]|$)/i.test(l))
    .map((l) => l.replace(/^[#*\s>\-]+/, "").slice(0, 60).trim())
    .filter((l) => l.length >= 4)
    .slice(0, 3);
  const sources = lines
    .filter((l) => /(sumber|paper|artikel|penelitian|studi)\b/i.test(l))
    .map((l) => l.replace(/^[#*\s>\-]+/, "").slice(0, 60).trim())
    .filter((l) => l.length >= 4)
    .slice(0, 3);

  return { topic: topic || "topik modul ini", concepts, theories, sources };
}

function formatAnchors(a: EssayAnchors): string {
  const parts: string[] = [`Topik: ${a.topic}`];
  if (a.concepts.length) parts.push(`Konsep kunci: ${a.concepts.join("; ")}.`);
  if (a.theories.length) parts.push(`Teori: ${a.theories.join("; ")}.`);
  if (a.sources.length) parts.push(`Sumber: ${a.sources.join("; ")}.`);
  return parts.join("\n");
}

async function tryEssay(system: string, promptText: string): Promise<TryResult> {
  const er = await generate({
    system,
    prompt: promptText,
    maxOutputTokens: 1024,
  });
  try {
    const parsed = EssayPromptSchema.parse(JSON.parse(stripFences(er.text)));
    return { prompt: parsed.prompt, usage: er.usage };
  } catch {
    // Malformed/over-prose output: don't swallow it — signal failure with usage.
    return { failed: true, usage: er.usage };
  }
}

// The question must be built AROUND 5W1H (Apa/Siapa/Kapan/Di mana/Mengapa/
// Bagaimana) and anchored to the module's own topic/concepts/theories/sources.
const SYSTEM_BASE =
  "Kamu menyusun SATU pertanyaan esai untuk modul ini. Bangun pertanyaan di " +
  "sekitar kerangka 5W1H (Apa, Siapa, Kapan, Di mana, Mengapa, Bagaimana) dan " +
  "gunakan jangkar konkret yang diberikan (topik, konsep kunci, teori, sumber) " +
  "agar pertanyaan spesifik untuk modul ini, bukan generik. Pertanyaan harus " +
  "terbuka, menguji pemahaman & penalaran mendalam, dan menyertakan panduan " +
  "5W1H singkat yang memandu mahasiswa. Keluarkan HANYA JSON: " +
  '{"prompt": string}. Jangan tulis teks lain di luar JSON.';
const SYSTEM_STRICT =
  "Keluarkan HANYA satu objek JSON valid, tanpa teks lain dan tanpa markdown " +
  'fence: {"prompt": "..."}. Prompt adalah pertanyaan esai 5W1H yang spesifik ' +
  "untuk modul, menggunakan jangkar yang diberikan. Jangan sertakan penjelasan.";

// Single, narrow question-only call with one stricter retry. Returns null only
// after both attempts fail (or the call itself throws). Every outcome is logged
// so a blank essay box is never a silent failure.
export async function generateEssayPrompt(
  moduleText: string,
  topicId?: string,
  topicTitle?: string,
): Promise<string | null> {
  const anchors = deriveAnchors(moduleText, topicTitle);
  const promptText =
    `Modul:\n\n${moduleText.slice(0, 4000)}\n\n` +
    `Jangkar konkret (wajib digunakan dalam pertanyaan):\n${formatAnchors(anchors)}`;

  for (const system of [SYSTEM_BASE, SYSTEM_STRICT]) {
    let res: TryResult;
    try {
      res = await tryEssay(system, promptText);
    } catch {
      // Network / key / blocked — not a parse failure; one failed-usage row then bail.
      await logAIUsage({ topicId, kind: "essay_failed", usage: { promptTokens: 0, candidatesTokens: 0 } });
      return null;
    }
    if ("failed" in res) {
      await logAIUsage({ topicId, kind: "essay_failed", usage: res.usage });
      continue;
    }
    await logAIUsage({ topicId, kind: "essay", usage: res.usage });
    return res.prompt;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deterministic 5W1H essay harness (0% AI, offline, always succeeds)
//
// `generateEssayPrompt` is the one legitimate AI call in the essay pipeline, but
// it can still fail (key/network/blocked) and leave the student with a blank
// essay box. This harness builds an equally 5W1H-grounded prompt from the
// module's OWN anchors with no model call, so essay generation can never
// silently fail. It is the guaranteed fallback used by
// `generateEssayPromptWithFallback`.
//
// Grounding discipline: every slot is anchored ONLY to clean, structured data —
// the real topic title and the short key-concept terms pulled from the module's
// own "Konsep kunci" section. We never splice a raw, sliced substring of the
// module body (e.g. `theories.slice(0, 60)`) into a question template: that is
// what produced the "Siapa … terlibat dalam Dalam kajian Teori … antari?" break,
// a mangled, mid-word-truncated phrase. Slots that theory-heavy content can't
// fill cleanly (Siapa/Kapan/Di mana) are phrased generically rather than
// force-filled with broken text.
// ---------------------------------------------------------------------------
export function generateEssayPromptHarness(moduleText: string, topicTitle?: string): string {
  const a = deriveAnchors(moduleText, topicTitle);
  const topic = a.topic || "topik modul ini";
  const concepts = a.concepts.length ? a.concepts.join(", ") : "konsep-konsep utama modul ini";

  return [
    `Tulis esai berdasarkan modul "${topic}". Esai harus menguji pemahaman dan penalaran mendalam, bukan sekadar meringkas.`,
    "",
    "Panduan 5W1H (wajib dijawab dalam esai):",
    `- Apa: Apa inti gagasan/konten yang dibahas pada modul "${topic}"?`,
    `- Siapa: Siapa tokoh, pemikir, atau kelompok yang berperan dalam topik ini?`,
    `- Kapan: Kapan gagasan tersebut muncul dan dalam konteks waktu yang bagaimana?`,
    `- Di mana: Di mana (konteks sosial, budaya, atau geografis) teori ini berkembang?`,
    `- Mengapa: Mengapa teori ini penting dan apa implikasinya bagi topik "${topic}"?`,
    `- Bagaimana: Bagaimana ${concepts} diaplikasikan dan dihubungkan antar sumber?`,
    "",
    `Gunakan ${concepts}, rujuk sumber yang disetujui (dengan sitasi [n] bila tersedia), dan bandingkan antar teori bila relevan.`,
  ].join("\n");
}

// Guaranteed essay prompt: use the AI-generated one when it succeeds, otherwise
// fall back to the deterministic harness so a module always ships with a usable
// essay question (never null). The harness path is logged as `essay_harness`
// with zero tokens so it stays observable that no AI was spent.
export async function generateEssayPromptWithFallback(
  moduleText: string,
  topicId?: string,
  topicTitle?: string,
): Promise<string> {
  const ai = await generateEssayPrompt(moduleText, topicId, topicTitle);
  if (ai) return ai;
  await logAIUsage({ topicId, kind: "essay_harness", usage: { promptTokens: 0, candidatesTokens: 0 } });
  return generateEssayPromptHarness(moduleText, topicTitle);
}

// ---- Harness rubric (0% AI) -------------------------------------------------
// Built from the module's fixed synthesis structure: key concepts (from the
// "Konsep kunci" section) become the interpretation criteria, plus fixed
// clarity / reasoning / grounding / comparison / relevance criteria.
// Concept extraction is delegated to the shared, boilerplate-aware
// `extractKeyConcepts` (src/lib/concepts.ts) so the essay prompt and rubric
// cannot mine template strings ("Setelah membaca modul ini, …") or run-on prose
// as "concepts" — the defect that once produced "Menafsirkan konsep kunci
// 'Setelah membaca modul ini,'" in the rubric.
function extractKeyConcepts(content: string): string[] {
  return extractModuleConcepts(content, 4);
}

export function buildEssayRubric(content: string): string {
  const concepts = extractKeyConcepts(content);
  const conceptLine = concepts.length
    ? concepts
        .map((c, i) => `  ${i + 1}. Menafsirkan konsep kunci "${c}" secara akurat (bukan sekadar menyebut).`)
        .join("\n")
    : "  - Menafsirkan konsep kunci yang ada di modul secara akurat.";
  return [
    "Rubrik esai (dibuat otomatis dari struktur modul):",
    "",
    "A. Penulisan (clarity):",
    "  - Bahasa jelas, terstruktur, dan kohesif; setiap paragraf fokus pada satu ide.",
    "  - Istilah modul digunakan tepat; tidak ada ambiguitas atau salah kaprah besar.",
    "",
    "B. Penafsiran (interpretation):",
    conceptLine,
    "  - Menafsirkan klaim/argumen tiap sumber secara akurat, bukan sekadar mengutip.",
    "",
    "C. Penalaran (reasoning):",
    "  - Argumen logis dan runtut: bukti → analisis → kesimpulan; menjawab kerangka",
    "    5W1H (Apa/Siapa/Kapan/Di mana/Mengapa/Bagaimana) untuk topik ini.",
    "  - Mengaitkan argumen dari tiap sumber (paper) dengan sitasi yang tepat.",
    "  - Membandingkan/mengontraskan antar teori bila relevan.",
    "",
    "D. Relevansi:",
    "  - Menyimpulkan relevansi topik untuk mata kuliah ini.",
  ].join("\n");
}

/**
 * Whether a stored essay prompt is safe to ship. The prompt must anchor to the
 * module's own key concepts — when it instead drifts into section-heading
 * fragments ("Modul Belajar", "Setelah membaca modul ini,") it is useless to the
 * student and must be replaced by the deterministic harness prompt
 * (`generateEssayPromptHarness`). We trust the prompt only when it actually
 * contains at least one of the module's real key-concept terms.
 */
export function isEssayPromptUsable(
  prompt: string | null | undefined,
  concepts: string[],
): boolean {
  if (!prompt?.trim()) return false;
  if (concepts.length === 0) return true; // nothing to anchor against; trust stored
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const np = norm(prompt);
  return concepts.some((c) => np.includes(norm(c)));
}

/** True when a stored rubric has no dangling open/close parenthesis. */
function rubricHasBalancedParens(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * Whether a stored essay rubric is safe to ship. A corrupted rubric is one that
 * lists concept-interpretation criteria referencing concept names that are NOT
 * among the module's real key concepts — the exact "severe regression" shape
 * where the rubric cited section-heading fragments ("Modul Belajar",
 * "Setelah membaca modul ini,", "Topik "Tingkatan Aktor dan"") instead of the
 * module's actual terms. We trust the stored rubric only when it is
 * parenthesis-balanced AND every concept it cites is one of the module's real
 * concepts (or it follows a different, non-concept-citation shape entirely, e.g.
 * "1. Definisi 2. Contoh", which is a valid alternate rubric we must not
 * overwrite). When it fails, the caller rebuilds the rubric deterministically
 * from the module's real concepts.
 */
export function isEssayRubricUsable(
  rubric: string | null | undefined,
  concepts: string[],
): boolean {
  if (!rubric?.trim()) return false;
  if (!rubricHasBalancedParens(rubric)) return false;
  const refs = [...rubric.matchAll(/Menafsirkan konsep kunci "([^"]+)"/gi)].map((m) => m[1]);
  if (refs.length === 0) return true; // alternate rubric shape; trust it
  if (concepts.length === 0) return true;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const nc = concepts.map(norm);
  return refs.some((r) => nc.includes(norm(r)));
}
