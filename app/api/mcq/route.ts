import { NextRequest, NextResponse } from "next/server";
import { generate } from "@/src/lib/gemini";
import { generateMCQ } from "@/src/lib/mcq";
import { logAIUsage } from "@/src/lib/aiusage";
import type { MCQQuestion } from "@/app/lib/types";
import {
  GUARD_STATUS,
  LIMITS,
  firstGuardError,
  guardBodyBytes,
  guardLength,
} from "@/src/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `Kamu adalah pembuat soal latihan untuk mahasiswa yang mempersiapkan kuliah dari modul belajar.
Buatlah N soal pilihan ganda yang menguji PEMAHAMAN, bukan sekadar mengisi kosakata.
Aturan ketat:
- Tiap soal berupa pertanyaan bermakna (misal "Mengapa...?", "Apa perbedaan...?", "Bagaimana...") yang relevan dan penting untuk topik modul.
- Tepat 4 opsi yang BERBEDA, masuk akal, dan sebanding panjangnya (maksimal 18 kata per opsi). Jangan ada opsi yang mengulang opsi lain.
- Tepat satu opsi benar; distraktor harus plausibel namun salah, diambil dari konsep terkait dalam modul (bukan kata acak).
- "explanation" maksimal satu kalimat menjelaskan mengapa jawaban benar, merujuk pada isi modul.
Keluarkan HANYA JSON: array objek {"stem":string,"options":[string,string,string,string],"answer":string,"explanation":string}.
Nilai "answer" harus PERSIS sama dengan salah satu elemen "options". Jangan tulis teks apa pun di luar JSON.`;

function parseQuestions(text: string): MCQQuestion[] {
  let raw = text.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) raw = fenced[1].trim();
  const start = raw.indexOf("[");
  if (start !== -1) raw = raw.slice(start);

  const tryParse = (s: string): unknown => JSON.parse(s);

  try {
    return normalize(tryParse(raw));
  } catch {
    // salvage truncated output: keep up to the last complete object
    const lastBrace = raw.lastIndexOf("}");
    if (lastBrace !== -1) {
      const salvaged = raw.slice(0, lastBrace + 1) + "]";
      return normalize(tryParse(salvaged));
    }
    throw new Error("unparseable JSON");
  }
}

function normalize(data: unknown): MCQQuestion[] {
  if (!Array.isArray(data)) throw new Error("not an array");
  const out: MCQQuestion[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const stem = typeof o.stem === "string" ? o.stem.trim() : "";
    const options = Array.isArray(o.options)
      ? (o.options.filter((x) => typeof x === "string" && x.trim()) as string[])
      : [];
    const answer = typeof o.answer === "string" ? o.answer : "";
    if (!stem || options.length < 2) continue;
    if (!options.includes(answer)) continue;
    const unique = options.filter((x, i) => options.indexOf(x) === i);
    if (unique.length < 2) continue;
    out.push({
      id: `q${out.length + 1}`,
      stem,
      options: unique,
      answer,
      explanation: typeof o.explanation === "string" ? o.explanation : undefined,
    });
  }
  if (out.length === 0) throw new Error("no valid questions");
  return out;
}

export async function POST(req: NextRequest) {
  const bodyTooBig = guardBodyBytes(req.headers.get("content-length"));
  if (bodyTooBig) {
    return NextResponse.json({ error: bodyTooBig.error }, { status: GUARD_STATUS });
  }

  let body: { text?: string; count?: number; topicId?: string; useLLM?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "Field 'text' is required." }, { status: 400 });
  }

  // Bound the input before either path runs: the LLM prompt is sliced to 6.000
  // chars below, but the deterministic harness scans the WHOLE text, so an
  // unbounded module would burn CPU even with no API call (I7).
  const violation = firstGuardError(
    guardLength("text", "Teks modul", text, LIMITS.moduleText),
  );
  if (violation) {
    return NextResponse.json({ error: violation.error }, { status: GUARD_STATUS });
  }

  const count = Math.min(Math.max(Number(body.count) || 8, 1), 12);

  // Harness-first: the deterministic generator is the PRIMARY path and makes
  // zero API calls (whitepaper §4 Stage 4 / I7), so the AI does less work. The
  // LLM is now OPTIONAL, used only when the caller explicitly opts in via
  // `useLLM` — this directly lightens the AI's workload.
  const useLLM = body.useLLM === true;

  if (!useLLM) {
    const questions = generateMCQ(text, count).map((q) => ({
      id: q.id,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      ...(q.explanation ? { explanation: q.explanation } : {}),
    }));
    return NextResponse.json({ questions, generatedBy: "fallback" });
  }

  const prompt = `Modul:\n\n${text.slice(0, 12000)}\n\nBuat tepat ${count} soal pilihan ganda dari modul di atas.`;

  try {
    const result = await generate({
      system: SYSTEM,
      prompt,
      maxOutputTokens: 4096,
      temperature: 0.4,
    });
    // Observability: every real Gemini call is logged (whitepaper §3/§6, E3/G10).
    await logAIUsage({ topicId: body.topicId, kind: "mcq", usage: result.usage });
    const questions = parseQuestions(result.text);
    return NextResponse.json({ questions, generatedBy: "llm" });
  } catch {
    // LLM path failed: fall back to the deterministic harness (no API call).
    const fallback = generateMCQ(text, count).map((q) => ({
      id: q.id,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      ...(q.explanation ? { explanation: q.explanation } : {}),
    }));
    return NextResponse.json({ questions: fallback, generatedBy: "fallback" });
  }
}
