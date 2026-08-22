import { NextRequest, NextResponse } from "next/server";
import { embedTexts, generate } from "@/src/lib/gemini";
import { logAIUsage, assertBudget } from "@/src/lib/aiusage";
import { prisma } from "@/src/lib/prisma";
import { rankChunks, rankChunksHybrid, type RankableChunk } from "@/src/lib/retrieval";
import {
  GUARD_STATUS,
  LIMITS,
  firstGuardError,
  guardBodyBytes,
  guardChars,
  guardLength,
  totalLength,
} from "@/src/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stage 3 (whitepaper §4/§5): retrieval-augmented, scoped Q&A. The model may only
// answer from the injected module chunks; out-of-scope questions are declined.
const SYSTEM = `Jawab HANYA berdasarkan cuplikan modul (chunks) dan paper sumber yang diberikan.
Jika pertanyaan berada di luar cakupan sumber tersebut, katakan secara eksplisit bahwa informasi tidak tersedia di modul.
Jangan mengarang jawaban di luar sumber.`;

// How many retrieved chunks we inject into the prompt.
const RETRIEVE_K = 5;

export async function POST(req: NextRequest) {
  const bodyTooBig = guardBodyBytes(req.headers.get("content-length"));
  if (bodyTooBig) {
    return NextResponse.json({ error: bodyTooBig.error }, { status: GUARD_STATUS });
  }

  let body: { moduleId?: string; topicId?: string; question?: string; chunks?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "Field 'question' is required." }, { status: 400 });
  }

  // Cost gate (workstream C): never spend a Gemini call past the hard budget cap.
  // Must run BEFORE the first paid call, which here is embedTexts() during RAG
  // retrieval — so it sits above the moduleId branch, not below the field guards.
  try {
    await assertBudget();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 429 });
  }

  // Resolve the RAG context. Preferred path: server-side retrieval from the
  // module's stored chunks. Legacy fallback: a caller-supplied chunks array.
  let retrievedTexts: string[] = [];
  const legacyChunks = Array.isArray(body.chunks) ? body.chunks : [];

  if (body.moduleId) {
    const rows = await prisma.moduleChunk.findMany({
      where: { moduleId: body.moduleId },
      select: { id: true, text: true, embedding: true },
      take: LIMITS.chunkCount,
    });
    if (rows.length > 0) {
      const chunks: RankableChunk[] = rows.map((r) => {
        let embedding: number[] | undefined;
        try {
          const parsed = JSON.parse(r.embedding);
          if (Array.isArray(parsed) && parsed.length > 0) embedding = parsed as number[];
        } catch {
          // Legacy stub "[]" or unparseable — lexical fallback handles it.
        }
        return { id: r.id, text: r.text, embedding };
      });
      // Dense retrieval is best-effort: if embedding the query fails (no key,
      // upstream error), fall back to lexical-only ranking. The hybrid ranker
      // also collapses to lexical when no chunk carries a vector.
      let queryEmbedding: number[] = [];
      try {
        const embedded = await embedTexts([question]);
        queryEmbedding = embedded[0] ?? [];
      } catch {
        queryEmbedding = [];
      }
      const ranked = queryEmbedding.length
        ? rankChunksHybrid(chunks, question, queryEmbedding, RETRIEVE_K)
        : rankChunks(chunks, question, RETRIEVE_K);
      retrievedTexts = ranked.map((r) => r.text);
    }
  } else if (legacyChunks.length > 0) {
    const cappedLegacy = legacyChunks.slice(0, LIMITS.chunkCount);
    const ranked = rankChunks(
      cappedLegacy.map((text, i) => ({ id: `c${i}`, text })),
      question,
      RETRIEVE_K,
    );
    retrievedTexts = ranked.map((r) => r.text);
  }

  // Bound the prompt before spending a Gemini call (I7/I8, mitigates R4).
  const violation = firstGuardError(
    guardLength("question", "Pertanyaan", question, LIMITS.question),
    guardChars(
      "chunksTotal",
      "Konteks modul yang dikirim",
      totalLength(retrievedTexts),
      LIMITS.chunksTotal,
    ),
  );
  if (violation) {
    return NextResponse.json({ error: violation.error }, { status: GUARD_STATUS });
  }

  const context = retrievedTexts.length
    ? retrievedTexts.map((c, i) => `Cuplikan ${i + 1}:\n${c}`).join("\n\n")
    : "(tidak ada cuplikan modul yang diberikan)";

  const prompt = `Modul (sumber satu-satunya):\n\n${context}\n\nPertanyaan: ${question}`;

  try {
    const result = await generate({ system: SYSTEM, prompt, maxOutputTokens: 1024 });
    await logAIUsage({ topicId: body.topicId, kind: "qa", usage: result.usage });
    return NextResponse.json({ answer: result.text, usage: result.usage });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
