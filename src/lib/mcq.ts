// Deterministic MCQ generation from module text — NO API call (whitepaper §4 Stage 4).
// Produces cloze-style questions by masking a key term in a sentence and supplying
// distractors drawn from other terms in the same corpus. Grading is exact-match
// (see the UI), so no LLM is ever involved.

// Canonical type lives in app/lib/types (shared with the UI / API layer).
import type { MCQQuestion } from "@/app/lib/types";

export type { MCQQuestion };

const STOPWORDS = new Set(
  (
    "dan atau dari pada ke dalam yang dengan untuk oleh adalah merupakan sebagai " +
    "ini itu dia kami kita mereka ada tidak akan dapat sangat lebih karena selain " +
    "antara tentang terhadap sebuah sebuahnya dengan"
  ).split(" "),
);

// Headings and the trailing bibliography are not recall material: masking a word
// out of "MODUL: POLITIK BUDAYA" or out of "Bourdieu, P. (1977). Outline…"
// produces a card that tests nothing. They are dropped before sentence
// splitting — these cards feed both the Latih fallback and the Anki export, so
// junk here would land in the student's long-term deck.
const SOURCES_HEADING =
  /^[#*\s>]*(?:sources|sumber|daftar\s+pustaka|referensi|references)\b\s*:?\s*\**\s*$/i;

function studyProse(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const sourcesAt = lines.findIndex((line) => SOURCES_HEADING.test(line));
  const body = sourcesAt === -1 ? lines : lines.slice(0, sourcesAt);
  return body.filter((line) => !/^\s{0,3}#{1,6}\s/.test(line)).join("\n");
}

function splitSentences(text: string): string[] {
  const noMd = studyProse(text)
    .replace(/[#*_`>\-]/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1");
  return noMd
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 320);
}

function collectTerms(text: string): string[] {
  const words = text
    .replace(/[#*_`>\-]/g, " ")
    .toLowerCase()
    .split(/[^a-zà-ÿ]+/i)
    .filter((w) => w.length >= 5 && !STOPWORDS.has(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

// Rough stem (first 5 letters) — cheap morphological-variant check so a distractor
// is never "habitual" next to the answer "habitus". Good enough without a POS tagger.
function stem(w: string): string {
  const s = w.toLowerCase();
  return s.slice(0, Math.min(5, s.length));
}

// Term frequency across the study prose: a concept appearing 3+ times is a real
// node, not a one-off word, so it makes a better mask target (semantic salience).
function termFrequency(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const words = text.toLowerCase().split(/[^a-zà-ÿ]+/i);
  for (const w of words) {
    if (w.length >= 5 && !STOPWORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return counts;
}

// Terms declared in the module's "Konsep kunci" section are the intended concepts;
// prefer masking them over prose-only terms.
function keyConceptTerms(text: string): Set<string> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const idx = lines.findIndex((l) => /^\s*#{0,6}\s*(?:konsep\s+kunci|konsep\s+utama)\b/i.test(l));
  if (idx === -1) return new Set();
  const out = new Set<string>();
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^\s*#{1,6}\s/.test(lines[i])) break;
    for (const w of lines[i].toLowerCase().split(/[^a-zà-ÿ]+/i)) {
      if (w.length >= 5 && !STOPWORDS.has(w)) out.add(w);
    }
  }
  return out;
}

// Pick the most salient maskable term in a sentence: frequency-weighted, with a
// large bonus for key-concept terms (Bug 2.2).
function bestMaskTerm(
  sentence: string,
  termSet: Set<string>,
  freq: Map<string, number>,
  keySet: Set<string>,
): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const w of sentence.split(/\s+/)) {
    const clean = w.replace(/[^a-zà-ÿ]/gi, "").toLowerCase();
    if (clean.length >= 5 && termSet.has(clean)) {
      const score = (freq.get(clean) ?? 1) + (keySet.has(clean) ? 1000 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = w;
      }
    }
  }
  return best;
}

// Distractor pool: exclude the answer and any morphological variant (same stem),
// then prefer plausible wrong answers that are semantically related — drawn from
// the same declared key-concept cluster (Konsep kunci) — before falling back to
// length-proximity prose words (Bug 2.3). No LLM needed, just better filtering.
function pickDistractors(
  terms: string[],
  correct: string,
  keySet: Set<string>,
  count = 3,
): string[] {
  const cStem = stem(correct);
  const cLen = correct.length;
  const eligible = terms.filter((t) => t !== correct && stem(t) !== cStem);
  // Related = same key-concept cluster: clearly "from the same topic" as the
  // answer, so the choice tests understanding rather than a random word.
  const related = eligible.filter((t) => keySet.has(t));
  const unrelated = eligible.filter((t) => !keySet.has(t));
  const rank = (a: string, b: string) =>
    Math.abs(a.length - cLen) - Math.abs(b.length - cLen) || a.length - b.length;
  const ranked = [...related.sort(rank), ...unrelated.sort(rank)];
  const out: string[] = [];
  for (const t of ranked) {
    if (!out.includes(t)) out.push(t);
    if (out.length >= count) break;
  }
  return out;
}

function chunkText(text: string, size: number): string[] {
  const paras = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const para of paras) {
    if (cur && (cur + "\n\n" + para).length > size) {
      chunks.push(cur);
      cur = para;
    } else {
      cur = cur ? `${cur}\n\n${para}` : para;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text];
}

export interface Claim {
  text: string;
  paperIndex: number | null; // 1-based inline citation [n], or null if absent
}

/**
 * Claim-like lines with their inline citation index, if any.
 *
 * `limit` exists because two callers need the SAME claim definition at different
 * scales: MCQ generation only needs a handful of excerpt-worthy claims (default
 * 16), while the Tier 1 accuracy verifier (src/lib/tier1.ts) must count EVERY
 * claim in the module or its uncited-claim ratio would be computed over a
 * truncated sample and report a flattering number. Pass `Infinity` for "all".
 */
function extractClaims(text: string, limit = 16): Claim[] {
  // A claim line is a substantive statement: it either carries an inline [n]
  // source marker or matches a claim cue (definition/attribution/contrast). The
  // broader the net, the better the excerpts track the module's actual sources.
  const CLAIM_CUE =
    /definisi|konsep|adalah|merupakan|:|menurut|berdasarkan|bahwa|teori|sebaliknya|berbeda|kontras|implikasi/i;
  const claims = text
    .split("\n")
    .map((l) => l.replace(/^[#*\s>\-]+/, "").trim())
    .filter(
      (l) =>
        l.length > 20 &&
        (CLAIM_CUE.test(l) || /\[\d+\]/.test(l)),
    )
    .map((l) => {
      const m = /\[(\d+)\]/.exec(l);
      return { text: l, paperIndex: m ? Number(m[1]) : null };
    });
  return Number.isFinite(limit) ? claims.slice(0, limit) : claims;
}

export const mcqHelpers = { chunkText, extractClaims };

export function generateMCQ(text: string, count = 5): MCQQuestion[] {
  // Bug 2.1: the term/distractor pool is built from the study prose only, so the
  // trailing bibliography (author names, journal titles) can never leak into the
  // distractors. Sentences come from the same filtered text.
  const prose = studyProse(text);
  const sentences = splitSentences(text);
  const terms = collectTerms(prose);
  const termSet = new Set(terms);
  const freq = termFrequency(prose);
  const keySet = keyConceptTerms(prose);

  // Candidate masks: the most salient term per sentence (Bug 2.2 — key-concept /
  // frequent terms preferred as the mask).
  // `cite` captures an inline [n] source marker if the sentence carries one, so
  // we can prefer GROUNDED sentences (claims tied to a paper) and surface the
  // citation in the explanation — stronger correlation with the module's sources.
  const CITE_RE = /\[(\d+)\]/;
  type Cand = { sentence: string; raw: string; clean: string; cite: string | null };
  const cands: Cand[] = [];
  for (const sentence of sentences) {
    const raw = bestMaskTerm(sentence, termSet, freq, keySet);
    if (!raw) continue;
    const clean = raw.replace(/[^a-zà-ÿ]/gi, "").toLowerCase();
    const cite = sentence.match(CITE_RE)?.[0] ?? null;
    cands.push({ sentence, raw, clean, cite });
  }

  // Group candidates by concept term so the set can span DISTINCT concepts
  // instead of the first few sentences all masking the same word (coverage).
  const groups = new Map<string, Cand[]>();
  const firstIdx = new Map<string, number>();
  cands.forEach((c, i) => {
    if (!groups.has(c.clean)) {
      groups.set(c.clean, []);
      firstIdx.set(c.clean, i);
    }
    groups.get(c.clean)!.push(c);
  });

  // Deterministic concept order: key-concept terms first, then by frequency,
  // tie-broken by first appearance — stable across identical inputs.
  const order = [...groups.keys()].sort((a, b) => {
    const sa = (freq.get(a) ?? 1) + (keySet.has(a) ? 1000 : 0);
    const sb = (freq.get(b) ?? 1) + (keySet.has(b) ? 1000 : 0);
    return sb - sa || (firstIdx.get(a) ?? 0) - (firstIdx.get(b) ?? 0);
  });

  // Within each concept, prefer candidates that carry an inline [n] citation so
  // the question is grounded to a real source claim from the module (a concept
  // may appear in both a grounded sentence and a header-style sentence).
  for (const list of groups.values()) {
    list.sort((a, b) => (b.cite ? 1 : 0) - (a.cite ? 1 : 0));
  }

  // Round-robin across concepts: each round emits at most one question per
  // concept, so a 5-question set spreads over 5 distinct terms when available.
  const cursor = new Array(order.length).fill(0);
  const exhausted = new Array(order.length).fill(false);
  const questions: MCQQuestion[] = [];
  let guard = 0;
  while (questions.length < count && guard++ < order.length * 64 + 64) {
    let progressed = false;
    for (let bi = 0; bi < order.length; bi++) {
      if (questions.length >= count) break;
      if (exhausted[bi]) continue;
      const term = order[bi];
      const list = groups.get(term)!;
      const i = cursor[bi];
      if (i >= list.length) {
        exhausted[bi] = true;
        continue;
      }
      cursor[bi] = i + 1;
      if (cursor[bi] >= list.length) exhausted[bi] = true;

      const c = list[i];
      const correct = c.raw.replace(/[^a-zà-ÿ]/gi, "");
      const stemText = c.sentence.replace(c.raw, "_____");
      const distractors = pickDistractors(terms, c.clean, keySet, 3);
      if (distractors.length < 3) continue;

      const opts = [correct, ...distractors];
      const rot = questions.length % opts.length; // deterministic: avoid fixed position
      const options = opts.slice(rot).concat(opts.slice(0, rot));

      // The explanation restates the filled-in sentence and, when the source
      // sentence carried a citation, keeps the [n] marker so the student can
      // jump to the exact paper the claim came from (grounding, I5).
      const citeTag = c.cite ? ` ${c.cite}` : "";
      questions.push({
        id: `q${questions.length + 1}`,
        stem: stemText,
        options,
        answer: correct,
        explanation: stemText.replace("_____", correct) + citeTag,
      });
      progressed = true;
    }
    if (!progressed) break;
  }
  return questions;
}
