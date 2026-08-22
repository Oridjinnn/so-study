import { NextRequest, NextResponse } from "next/server";
import { embedTexts, generate, streamGenerate, type GeminiResult, type GeminiUsage } from "@/src/lib/gemini";
import { logAIUsage, assertBudget } from "@/src/lib/aiusage";
import { SourcePaper } from "@/src/lib/sources";
import { prisma } from "@/src/lib/prisma";
import { ensureTopic } from "@/src/lib/topics";
import { mcqHelpers } from "@/src/lib/mcq";
import { generateEssayPromptWithFallback, buildEssayRubric } from "@/src/lib/essay";
import {
  verifyGrounding,
  type GroundingReport,
  type GroundingSource,
} from "@/src/lib/grounding";
import { verifyTier1 } from "@/src/lib/tier1";
import { runVerification } from "@/src/lib/verification";
import { computeGauge, type GaugeResult } from "@/src/lib/gauge";
import {
  GUARD_STATUS,
  LIMITS,
  firstGuardError,
  guardBodyBytes,
  guardCount,
  guardLength,
} from "@/src/lib/guards";
import {
  MIN_WORDS,
  buildExpansionSystem,
  expandModuleUntilFloor,
  estimatePagesFromWords,
  countWords,
  type ExpandResult,
} from "@/src/lib/pages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stage 2 (whitepaper §4): synthesize a per-topic study module from APPROVED
// papers only. Retrieval is heuristic + cached (no LLM); synthesis is bounded +
// logged. The human approval gate (TopicPaper.approved) is enforced: when a
// topicId is supplied we synthesize strictly from that topic's approved papers.
// Exported for unit testing: the disciplinary framing is a behavioural
// contract (Change 1), not cosmetic prompt text, so it is asserted directly.
export function buildSystem(courseName: string, major?: string) {
  // The jurusan is explicit framing, not decoration: without it the model
  // produces a generic cross-disciplinary summary, and the same approved papers
  // would yield the same module whether the student reads them as an
  // anthropologist or a sociologist.
  const majorFraming = major
    ? `\nJurusan (disiplin) mahasiswa: "${major}".
Bacalah dan susun sumber-sumber ini MELALUI lensa disiplin ${major}: utamakan konsep, tradisi teoretis, unit analisis, dan istilah yang dipakai di ${major}.
Jika sebuah sumber berasal dari disiplin lain, tetap gunakan, tetapi jelaskan relevansinya bagi ${major}.
Jangan menghasilkan ringkasan lintas-disiplin yang generik.`
    : "";
  return `Kamu adalah asisten penyusun modul belajar untuk mata kuliah "${courseName}".${majorFraming}
Tugasmu: dari kumpulan paper akademik yang diberikan, susun modul belajar yang koheren, LUAS, dan terstruktur dalam Bahasa Indonesia, mengikuti kerangka instruksional Gagné (sembilan peristiwa pembelajaran) ditambah prinsip advance organizer (Gagné, Conditions of Learning).
Gunakan HANYA informasi dari paper yang diberikan. Jangan tambahkan teori di luar sumber.
Struktur wajib, TEPAT URUTAN berikut (gunakan heading "##" untuk bagian tingkat atas, dan "###" untuk sub-bagian per konsep):
1. Tujuan Pembelajaran — 3–5 poin bullet yang diawali "Setelah membaca modul ini, kamu bisa: ..." (advance organizer; tulis DI AWAL, jangan dilewati — ini yang paling menentukan pemahaman).
2. Mengapa topik ini penting — satu paragraf singkat yang menyambung topik ke konteks mata kuliah (gain attention + relevansi dengan apa yang dibahas kuliah).
3. Konsep kunci & definisi — SETIAP konsep mendapat SUB-BAGIAN SENDIRI ("### Nama Konsep"): definisi yang jelas lalu elaborasi.
  4. Untuk SETIAP konsep kunci, ulangi blok berikut sebagai sub-bagian ("### Nama Konsep — penjelasan"):
    a. Argumen/penjelasan mendalam dari sumber (berakar pada paper yang disetujui, dengan penanda sitasi [n]).
    b. Contoh konkret atau ilustrasi kasus — SATU kasus terarbeit yang membuat teori abstrak menjadi konkret (elemen paling berharga untuk pemahaman, Gagné event 5: learner guidance). Tulis sebagai paragraf yang DIMULAI dengan teks "Contoh konkret: " (akan dirender sebagai kotak callout tersendiri di PDF).
    c. Pertanyaan refleksi singkat (1–2 pertanyaan, TIDAK dinilai) di akhir sub-bagian, untuk mahasiswa berhenti sejenak. Tulis sebagai paragraf yang DIMULAI dengan teks "Pertanyaan refleksi: " (akan dirender sebagai kotak callout berbeda di PDF).
5. Perbandingan/kontras antar konsep atau teori (jika relevan).
6. Rangkuman bab — ringkasan akhir modul (Gagné event 9: retensi/transfer), plus catatan eksplisit yang menghubungkan KEMBALI ke Tujuan Pembelajaran dari bagian 1 (apakah yang dijanjikan sudah dibahas).
7. Daftar istilah kunci (glosarium) — istilah + definisi satu baris, diambil dari konsep yang dibahas (panjang inkremental dengan nilai belajar nyata).
PANJANG & KEDALAMAN: modul ini ditargetkan setara MINIMAL 10 HALAMAN A4 (≈ 5000 kata). Isi tiap sub-bagian konsep (bagian 4) dengan penjelasan MENDALAM + contoh + refleksi, bukan ringkasan pendek; sub-bagian konseplah yang mencapai panjang halaman, bukan penambahan prose lain. Bahas SETIAP paper sumber secara eksplisit dan beri porsi seimbang antarpaper.
Sitasi inline WAJIB: setiap klaim yang diambil dari sebuah paper harus disitir dengan nomor [n] sesuai urutan paper di bawah (Paper 1 = [1], Paper 2 = [2], dst).
Akhiri dengan daftar bernomor "Sources:" yang merekap tiap paper (satu baris per paper, diawali nomor yang sama dengan sitasi inline-nya).`;
}

// ---------------------------------------------------------------------------
// SSE plumbing. Two protocols meet here: Gemini's `alt=sse` stream coming in and
// our own event stream going out. `src/lib/gemini.ts` owns the transport (key,
// HTTP failures) and hands over raw bytes; the translation, the persistence and
// the fallback decisions stay in the route, which is the only place that knows
// what a half-finished module means for the student.
// ---------------------------------------------------------------------------

interface StreamDelta {
  text: string;
  usage?: GeminiUsage;
  finishReason?: string;
}

/**
 * What the client is told about accuracy verification when synthesis finishes.
 *
 * Deliberately a SUMMARY, not the whole report: the full findings/judgment lists
 * are persisted on the Module and served by `GET /api/modules/[id]`, which the UI
 * fetches immediately afterwards to draw the gauge. Shipping them twice would
 * bloat the SSE frame for no gain.
 *
 * `blocked` is Tier 1's hard gate (phantom citation). `tier2Ran` is reported
 * honestly so the client never presents an unverified module as verified.
 */
interface AccuracySummary {
  blocked: boolean;
  score: number;
  band: GaugeResult["band"];
  flagCount: number;
  phantomCitations: number;
  tier2Ran: boolean;
  /**
   * True when the initial synthesis had no phantom citation but the post-
   * generation expansion passes introduced one — Tier 1 runs after EVERY pass
   * precisely so an expansion cannot smuggle a fabricated `[n]` past the gate.
   */
  phantomIntroducedByExpansion: boolean;
}

interface GeminiStreamChunk {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

/** One `data:`-carrying SSE frame → a delta, or null for keep-alives/noise. */
function parseSseFrame(frame: string): StreamDelta | null {
  const dataLines: string[] = [];
  for (const raw of frame.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n").trim();
  // A malformed frame is skipped, never fatal: losing one keep-alive must not
  // abort a synthesis that is otherwise streaming fine.
  if (!payload || payload === "[DONE]") return null;
  let chunk: GeminiStreamChunk;
  try {
    chunk = JSON.parse(payload) as GeminiStreamChunk;
  } catch {
    return null;
  }
  const candidate = chunk.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const usage = chunk.usageMetadata
    ? {
        promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
        candidatesTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
      }
    : undefined;
  return { text, usage, finishReason: candidate?.finishReason };
}

/** Incrementally decode a Gemini SSE byte stream into text deltas. */
async function* geminiDeltas(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamDelta, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // Normalize the whole (small) pending buffer, so a CRLF split across two
      // network chunks still ends a frame.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        const delta = parseSseFrame(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        if (delta) yield delta;
        cut = buffer.indexOf("\n\n");
      }
    }
    const tail = parseSseFrame((buffer + decoder.decode()).replace(/\r\n/g, "\n"));
    if (tail) yield tail;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function sseFrame(event: string | null, data: unknown): string {
  // JSON.stringify escapes newlines, so one `data:` line is always enough.
  return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const bodyTooBig = guardBodyBytes(req.headers.get("content-length"));
  if (bodyTooBig) {
    return NextResponse.json({ error: bodyTooBig.error }, { status: GUARD_STATUS });
  }

  let body: { topicId?: string; title?: string; keywords?: string[]; courseId?: string; courseIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const title: string = (body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "Field 'title' is required." }, { status: 400 });
  }

  const titleTooLong = guardLength("title", "Judul topik", title, LIMITS.title);
  if (titleTooLong) {
    return NextResponse.json({ error: titleTooLong.error }, { status: GUARD_STATUS });
  }

  // Cost gate (workstream C): must run BEFORE the first paid call (generate /
  // streamGenerate / embedTexts) AND before the topic-paper DB read below. It
  // sits in front of both the streaming and non-streaming paths, so a blocked
  // budget yields a clean 429 — never a half-open SSE stream.
  try {
    await assertBudget();
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 429 });
  }

  let papers: SourcePaper[];
  if (body.topicId) {
    // Gated path: only papers the human approved are used as sources.
    const approved = await prisma.topicPaper.findMany({
      where: { topicId: body.topicId, approved: true },
      include: { paper: true },
    });
    if (approved.length === 0) {
      return NextResponse.json(
        {
          error:
            "Belum ada paper yang disetujui. Tinjau & setujui paper dulu via /api/papers/[topicId].",
        },
        { status: 400 },
      );
    }
    papers = approved.map((tp) => ({
      title: tp.paper.title,
      authors: tp.paper.authors,
      year: tp.paper.year,
      abstract: tp.paper.abstract,
      sourceUrl: tp.paper.sourceUrl,
      citationCount: tp.paper.citationCount,
      relevanceScore: tp.paper.relevanceScore,
      fullTextAvailable: tp.paper.fullTextAvailable,
      doi: tp.paper.doi ?? "",
      venue: tp.paper.venue ?? "",
      volume: tp.paper.volume ?? "",
      issue: tp.paper.issue ?? "",
      pages: tp.paper.pages ?? "",
      publisher: tp.paper.publisher ?? "",
      type: (tp.paper.type as SourcePaper["type"]) ?? undefined,
      provider: tp.paper.providers ?? "openalex",
    }));
  } else {
    // topicId is required: the retrieve → approve → synthesize flow always
    // supplies it. The old no-topicId retrieval path was dead/legacy and is removed.
    return NextResponse.json(
      { error: "Field 'topicId' is required (use the retrieve → approve flow)." },
      { status: 400 },
    );
  }

  const corpus = papers
    .map(
      (p, i) =>
        `<<<PAPER ${i + 1} START>>>\nTitle: ${p.title} (${p.year})\nAbstract: ${p.abstract}\n<<<PAPER ${i + 1} END>>>`,
    )
    .join("\n\n");

  // The corpus is human-approved, but "approved" is not "bounded": guard the
  // paper count and the assembled prompt so one over-approved topic cannot
  // produce an unbounded Gemini call (I7/I8, mitigates R4).
  const corpusViolation = firstGuardError(
    guardCount("papers", "Paper yang disetujui", papers.length, LIMITS.paperCount),
    guardLength("corpus", "Kumpulan abstrak paper", corpus, LIMITS.moduleText),
  );
  if (corpusViolation) {
    return NextResponse.json({ error: corpusViolation.error }, { status: GUARD_STATUS });
  }

  const prompt =
    `Topik minggu ini: ${title}\n\n` +
    `Berikut adalah paper yang disetujui (GUNAKAN HANYA teks di antara penanda PAPER n START/END sebagai satu-satunya sumber, jangan gunakan pengetahuan lain):\n\n${corpus}\n\n` +
    `Susun modul belajar lengkap sesuai struktur yang diminta.`;

  const topic = await ensureTopic(title, body.topicId, body.courseId);

  // Resolve the real course name + jurusan for the prompt (falls back to
  // generic/no-lens if the course cannot be found).
  let courseName = "mata kuliah ini";
  let major: string | undefined;
  const course = await prisma.course.findUnique({ where: { id: topic.courseId } });
  if (course?.name) courseName = course.name;
  if (course?.major) major = course.major;

  // One prompt, two transports: the streaming attempt and the JSON fallback must
  // ask Gemini for exactly the same module, or a retry would silently produce a
  // different one than the student watched being written.
  const geminiOptions = {
    system: buildSystem(courseName, major),
    prompt,
    // Long module: a 10-page module needs far more than the old 4096 ceiling.
    // 8192 is the safe, widely-supported Flash output cap; tune upward only if
    // the configured model allows a larger max output.
    maxOutputTokens: 8192,
  };

  /**
   * Everything that used to run inline after `generate()` returned — usage row,
   * essay prompt/rubric, paper dedupe, Module + ModuleVersion + chunks +
   * excerpts, course links, topic status — in the same order, unchanged.
   *
   * Extracted so the streaming path and the JSON path persist through ONE
   * implementation: no matter how the response is shaped (or whether the client
   * can read it), the module is written exactly as before. Persistence is never
   * traded for streaming.
   *
   * The grounding report is computed here too, from the SAME markdown and the
   * SAME paper ids that get stored, so the report always describes the module as
   * persisted rather than some earlier draft of it.
   */
  async function finishSynthesis(
    result: GeminiResult,
    synthesisCtx: { courseName: string; major?: string; corpus: string; title: string },
  ): Promise<{
    moduleId: string;
    groundingReport: GroundingReport;
    pageMeta: ExpandResult;
    accuracy: AccuracySummary;
  }> {
    await logAIUsage({ topicId: topic.id, kind: "synthesize", usage: result.usage });

    // Harness-verified length (not prompt trust): after the initial synthesis,
    // MEASURE the real word count and, if under the ~10-page floor, expand ONLY
    // the thinnest per-concept subsection with a narrow second call (bounded to
    // 2 passes — see src/lib/pages.ts). Expansion is best-effort and advisory
    // like grounding: a failure must never block persistence, so it falls back
    // to the original text and ships what it has.
    let synthesisText = result.text;
    let pageMeta: ExpandResult = {
      finalText: result.text,
      passes: 0,
      metFloor: countWords(result.text) >= MIN_WORDS,
      wordCount: countWords(result.text),
      pageCount: estimatePagesFromWords(countWords(result.text)),
      complete: false,
    };
    try {
      pageMeta = await expandModuleUntilFloor(
        result.text,
        (opts) => generate(opts),
        {
          system: buildExpansionSystem(synthesisCtx.courseName, synthesisCtx.major),
        corpus: synthesisCtx.corpus,
        title: synthesisCtx.title,
        maxPasses: 2,
        maxCompletenessPasses: 3,
      },
      );
      synthesisText = pageMeta.finalText;
    } catch {
      synthesisText = result.text;
    }

    // Auto-generate a recall essay prompt from the module. The rubric is now
    // built by the harness (buildEssayRubric) from the module's own structure —
    // no second Gemini call (Change A: ~90% harness / 10% AI). The question is
    // the one legitimate AI call; generateEssayPrompt validates the schema and
    // retries once on malformed output, logging failures (never silent).
    // The essay question always ships: when the AI call fails, the deterministic
    // 5W1H harness (generateEssayPromptWithFallback) supplies a module-anchored
    // prompt, so essayPrompt is never null and the UI never shows a dead box.
    // The fallback is sync-safe (harness makes no model call), so awaiting it
    // cannot throw.
    const essayPrompt = await generateEssayPromptWithFallback(
      synthesisText.slice(0, 4000),
      topic.id,
      title,
    );
    const essayRubric = buildEssayRubric(synthesisText);

    // Stage 1+2 persistence: dedupe papers, link to topic, store Module + chunks + version + excerpts.
    const paperIds: string[] = [];
    // Grounding sources travel with the ids in the same order, so citation [n]
    // is checked against the paper it will actually resolve to on read.
    const sources: GroundingSource[] = [];
    for (const p of papers) {
      if (!p.sourceUrl) continue;
      const paper = await prisma.paper.upsert({
        where: { sourceUrl: p.sourceUrl },
        update: {
          title: p.title,
          authors: p.authors,
          year: p.year,
          abstract: p.abstract,
          citationCount: p.citationCount,
          relevanceScore: p.relevanceScore,
          fullTextAvailable: p.fullTextAvailable,
          doi: p.doi || null,
          venue: p.venue || null,
          volume: p.volume || null,
          issue: p.issue || null,
          pages: p.pages || null,
          publisher: p.publisher || null,
          type: p.type ?? null,
          providers: p.provider,
        },
        create: {
          title: p.title,
          authors: p.authors,
          year: p.year,
          abstract: p.abstract,
          sourceUrl: p.sourceUrl,
          citationCount: p.citationCount,
          relevanceScore: p.relevanceScore,
          fullTextAvailable: p.fullTextAvailable,
          doi: p.doi || null,
          venue: p.venue || null,
          volume: p.volume || null,
          issue: p.issue || null,
          pages: p.pages || null,
          publisher: p.publisher || null,
          type: p.type ?? null,
          providers: p.provider,
        },
      });
      paperIds.push(paper.id);
      sources.push({ id: paper.id, title: p.title, text: p.abstract });
      await prisma.topicPaper.upsert({
        where: { topicId_paperId: { topicId: topic.id, paperId: paper.id } },
        update: { approved: true },
        create: { topicId: topic.id, paperId: paper.id, approved: true },
      });
    }

    // Post-generation faithfulness check (harness, not a model call): does every
    // inline [n] point at a paper that exists and share vocabulary with it?
    // Advisory by design — it annotates the module, it never blocks it.
    const groundingReport = verifyGrounding(
      { contentMarkdown: synthesisText, sourcePaperIds: paperIds },
      sources,
    );

    // ---------------------------------------------------------------------
    // Two-tier accuracy verification (src/lib/tier1.ts + src/lib/critic.ts).
    //
    // Tier 1 runs after EVERY synthesis pass: once on the raw model output and
    // once on the final post-expansion text. It is free and deterministic, so
    // checking both is what proves an expansion pass cannot introduce a phantom
    // citation unnoticed. Only the FINAL report is stored — it is the one that
    // describes the module as persisted.
    //
    // Tier 2 (paid) runs ONCE here, at synthesis completion, and is cached on
    // the Module row; it is never re-run on read. It is advisory: a failure
    // leaves `critic` null and changes nothing about shipping.
    // ---------------------------------------------------------------------
    const tier1Initial = verifyTier1(
      { contentMarkdown: result.text, sourcePaperIds: paperIds },
      sources,
    );
    let verification;
    try {
      verification = await runVerification(
        { contentMarkdown: synthesisText, sourcePaperIds: paperIds },
        sources,
        {
          tier2: true,
          generate: (o) => generate(o),
          onUsage: (usage) => logAIUsage({ topicId: topic.id, kind: "critic", usage }),
        },
      );
    } catch {
      // Tier 2 plumbing (or its usage logging) failed. Fall back to Tier 1 only:
      // the deterministic gate must never depend on the second model call.
      const tier1 = verifyTier1(
        { contentMarkdown: synthesisText, sourcePaperIds: paperIds },
        sources,
      );
      verification = { tier1, critic: null, gauge: computeGauge(tier1, null) };
    }
    const accuracy: AccuracySummary = {
      blocked: verification.tier1.blocked,
      score: verification.gauge.score,
      band: verification.gauge.band,
      flagCount: verification.gauge.flagCount,
      phantomCitations: verification.tier1.citations.phantom,
      tier2Ran: Boolean(verification.critic?.ran),
      phantomIntroducedByExpansion:
        tier1Initial.citations.phantom === 0 && verification.tier1.citations.phantom > 0,
    };

    const chunks = mcqHelpers.chunkText(synthesisText, 800);
    const claims = paperIds.length ? mcqHelpers.extractClaims(synthesisText) : [];

    // Stage 2 persistence: one Module per Topic. Re-synthesis appends a new
    // ModuleVersion (never blind overwrite) and refreshes chunks/excerpts.
    const existing = await prisma.module.findUnique({ where: { topicId: topic.id } });
    const versionNo = existing
      ? (await prisma.moduleVersion.count({ where: { moduleId: existing.id } })) + 1
      : 1;

    const moduleData = {
      topicId: topic.id,
      contentMarkdown: synthesisText,
      sourcePaperIds: JSON.stringify(paperIds),
      essayPrompt,
      essayRubric,
      wordCount: pageMeta.wordCount,
      pageCount: pageMeta.pageCount,
      // Cached verification (Tier 1 gate + Tier 2 advisory flags) for this exact
      // content. Re-synthesis replaces both and resets the repair budget: a new
      // module gets its own 2 targeted-repair attempts.
      verifyReport: JSON.stringify(verification.tier1),
      criticReport: verification.critic ? JSON.stringify(verification.critic) : null,
      verifiedAt: new Date(),
      repairAttempts: 0,
    };
    // Dense retrieval (ROADMAP §15 gap B). Best-effort: if embedding fails (no
    // key, upstream error, surprise shape) we store the legacy "[]" stub and
    // retrieval degrades to lexical — synthesis must never block on a retrieval
    // enhancement.
    let chunkEmbeddings: number[][] = [];
    try {
      chunkEmbeddings = await embedTexts(chunks);
      await logAIUsage({ topicId: topic.id, kind: "embed", usage: { promptTokens: 0, candidatesTokens: 0 } });
    } catch {
      chunkEmbeddings = [];
    }
    const chunkData = chunks.map((text, i) => ({
      chunkIndex: i,
      text,
      embedding: JSON.stringify(chunkEmbeddings[i] ?? []),
    }));
    // P0-1: ground each excerpt to its TRUE source paper via inline citation [n].
    const excerptData = claims.length
      ? claims
          .filter((c) => c.paperIndex != null && paperIds[c.paperIndex - 1])
          .map((c) => ({
            paperId: paperIds[c.paperIndex! - 1],
            claim: c.text,
            quote: c.text,
            location: "synthesis",
          }))
      : undefined;

    let moduleId: string;
    if (existing) {
      // Refresh is atomic: delete old chunks/excerpts and write the new module
      // + version + chunks + excerpts in one transaction, so a failure mid-way
      // never leaves a module with stale chunks and no excerpts.
      await prisma.$transaction([
        prisma.moduleChunk.deleteMany({ where: { moduleId: existing.id } }),
        prisma.excerpt.deleteMany({ where: { moduleId: existing.id } }),
        prisma.module.update({
          where: { id: existing.id },
          data: {
            ...moduleData,
            versions: {
              create: { version: versionNo, contentMarkdown: synthesisText, changeNote: "re-synthesis" },
            },
            chunks: { create: chunkData },
            excerpts: excerptData ? { create: excerptData } : undefined,
          },
        }),
      ]);
      moduleId = existing.id;
    } else {
      const created = await prisma.module.create({
        data: {
          ...moduleData,
          chunks: { create: chunkData },
          versions: {
            create: { version: versionNo, contentMarkdown: synthesisText, changeNote: "initial synthesis" },
          },
          excerpts: excerptData ? { create: excerptData } : undefined,
        },
      });
      moduleId = created.id;
    }

    const linkCourseIds = Array.from(
      new Set([body.courseId, ...(Array.isArray(body.courseIds) ? body.courseIds : [])].filter(
        (c): c is string => Boolean(c),
      )),
    );
    for (const cid of linkCourseIds) {
      await prisma.courseModule.upsert({
        where: { courseId_moduleId: { courseId: cid, moduleId } },
        update: {},
        create: { courseId: cid, moduleId },
      });
    }

    // Mark the topic as having a generated module so the dashboard reflects
    // real engagement (module exists) rather than just fetched papers.
    try {
      await prisma.topic.update({
        where: { id: topic.id },
        data: { status: "module_generated" },
      });
    } catch {
      /* non-fatal: module is already persisted */
    }

    return { moduleId, groundingReport, pageMeta, accuracy };
  }

  /**
   * Try to open the Gemini stream AND pull its first delta before any header is
   * written. That ordering is the whole fallback strategy: a missing key, an
   * upstream 4xx/5xx, a model without streaming support or an unparseable
   * stream all fail HERE, while the response is still a normal JSON response
   * waiting to be built. Returns null to mean "no stream — use the JSON path".
   */
  async function openDeltaStream(): Promise<
    { first: StreamDelta; deltas: AsyncGenerator<StreamDelta, void, unknown> } | null
  > {
    let deltas: AsyncGenerator<StreamDelta, void, unknown> | null = null;
    try {
      deltas = geminiDeltas(await streamGenerate(geminiOptions));
      const firstStep = await deltas.next();
      if (firstStep.done) {
        await deltas.return();
        return null;
      }
      return { first: firstStep.value, deltas };
    } catch {
      if (deltas) await deltas.return().catch(() => {});
      return null;
    }
  }

  function streamingResponse(opened: {
    first: StreamDelta;
    deltas: AsyncGenerator<StreamDelta, void, unknown>;
  }): Response {
    const encoder = new TextEncoder();
    let clientGone = false;

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string | null, data: unknown) => {
          if (clientGone) return;
          try {
            controller.enqueue(encoder.encode(sseFrame(event, data)));
          } catch {
            // The client hung up mid-write: stop writing, keep synthesizing.
            clientGone = true;
          }
        };

        let text = "";
        let usage: GeminiUsage = { promptTokens: 0, candidatesTokens: 0 };
        const consume = (delta: StreamDelta) => {
          if (delta.finishReason === "SAFETY" || delta.finishReason === "RECITATION") {
            // Same contract as the non-streaming `generate`.
            throw new Error(`Gemini response blocked (${delta.finishReason}).`);
          }
          if (delta.usage) usage = delta.usage;
          if (delta.text) {
            text += delta.text;
            send(null, { text: delta.text });
          }
        };

        try {
          consume(opened.first);
          for (;;) {
            const step = await opened.deltas.next();
            if (step.done) break;
            consume(step.value);
          }
          if (!text.trim()) throw new Error("Gemini stream produced no module text.");

          // The full module arrived: persist it and hand the client the ids +
          // grounding report it needs to open the module view.
          const { moduleId, groundingReport, pageMeta, accuracy } = await finishSynthesis(
            { text, usage },
            { courseName, major, corpus, title },
          );
          send("done", {
            moduleId,
            topicId: topic.id,
            groundingReport,
            module: text,
            usage,
            stored: true,
            pageCount: pageMeta.pageCount,
            wordCount: pageMeta.wordCount,
            metFloor: pageMeta.metFloor,
            expansionPasses: pageMeta.passes,
            accuracy,
          });
        } catch (streamError) {
          // Headers are already on the wire, so a JSON body is no longer an
          // option — but the student must still end up with a persisted module.
          // Retry once without streaming and emit the SAME `done` payload the
          // client already knows how to handle; only a second failure surfaces
          // as `event: error`. Skipped when nobody is listening any more, so a
          // closed tab cannot trigger an extra Gemini call.
          if (!clientGone) {
            try {
              const result = await generate(geminiOptions);
              const { moduleId, groundingReport, pageMeta, accuracy } = await finishSynthesis(result, {
                courseName,
                major,
                corpus,
                title,
              });
              send("done", {
                moduleId,
                topicId: topic.id,
                groundingReport,
                module: result.text,
                usage: result.usage,
                stored: true,
                fallback: (streamError as Error).message,
                pageCount: pageMeta.pageCount,
                wordCount: pageMeta.wordCount,
                metFloor: pageMeta.metFloor,
                expansionPasses: pageMeta.passes,
                accuracy,
              });
            } catch (fatal) {
              send("error", { error: (fatal as Error).message });
            }
          }
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed by the client */
          }
        }
      },
      async cancel() {
        // Client disconnected: stop pulling from Gemini. A partially streamed
        // module is deliberately NOT persisted — half a module that reads as
        // whole is worse than re-running a synthesis nobody is waiting for.
        clientGone = true;
        await opened.deltas.return().catch(() => {});
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // nginx/Vercel must not buffer, or the progressive module only shows up
        // when the request ends — which defeats the point of streaming it.
        "X-Accel-Buffering": "no",
      },
    });
  }

  try {
    // SSE only for clients that asked for it (the UI sends the Accept header).
    // Everything else — curl, tests, an older client, a proxy that strips SSE —
    // keeps the exact JSON contract it had before.
    if ((req.headers.get("accept") ?? "").includes("text/event-stream")) {
      const opened = await openDeltaStream();
      if (opened) return streamingResponse(opened);
    }

    const result = await generate(geminiOptions);
    const { moduleId, groundingReport, pageMeta, accuracy } = await finishSynthesis(result, {
      courseName,
      major,
      corpus,
      title,
    });
    return NextResponse.json({
      module: result.text,
      usage: result.usage,
      moduleId,
      topicId: topic.id,
      stored: true,
      groundingReport,
      pageCount: pageMeta.pageCount,
      wordCount: pageMeta.wordCount,
      metFloor: pageMeta.metFloor,
      expansionPasses: pageMeta.passes,
      accuracy,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
