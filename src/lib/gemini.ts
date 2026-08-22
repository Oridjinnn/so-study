// Gemini (Google Generative Language) REST client — server-side only.
// No external SDK dependency; uses the global `fetch` in the Next.js runtime.
// The API key is read from GEMINI_API_KEY (never NEXT_PUBLIC_, never bundled).

export interface GeminiUsage {
  promptTokens: number;
  candidatesTokens: number;
}

export interface GeminiResult {
  text: string;
  usage: GeminiUsage;
}

export class GeminiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

const DEFAULT_MODEL = "gemini-3.6-flash";

// Embedding model for dense RAG retrieval. Cheap, no generation; one batch call
// covers a whole module's chunks. `text-embedding-004` is the stable GA model.
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "text-embedding-004";

// Approximate list pricing (USD per 1M tokens) for cost observability only.
// Estimates, not billing guarantees; adjust if your tier differs.
const INPUT_RATE_PER_1M = 0.1;
const OUTPUT_RATE_PER_1M = 0.4;

export function estimateCost(promptTokens: number, candidatesTokens: number): number {
  return (
    (promptTokens * INPUT_RATE_PER_1M + candidatesTokens * OUTPUT_RATE_PER_1M) / 1_000_000
  );
}

/**
 * A Gemini `responseSchema` (an OpenAPI-3-subset schema object). Typed loosely on
 * purpose: the REST API accepts a JSON schema document, and mirroring its full
 * grammar in TypeScript would drift from the API without buying safety — the
 * caller validates the PARSED result with zod, which is where correctness is
 * actually decided.
 */
export type GeminiResponseSchema = Record<string, unknown>;

export interface GenerateOptions {
  system?: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  model?: string;
  /**
   * Structured-output mode ("application/json"). Combined with `responseSchema`
   * this makes Gemini emit schema-conformant JSON instead of prose-wrapped,
   * fence-wrapped JSON — the failure mode that silently produced `null` essay
   * prompts before the JSON-mode fix. Callers still validate the parsed object:
   * JSON mode constrains the SHAPE, it does not make the content true.
   */
  responseMimeType?: "application/json" | "text/plain";
  responseSchema?: GeminiResponseSchema;
}

/** generationConfig shared by `generate` and `streamGenerate` (one contract). */
function generationConfig(opts: GenerateOptions): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    temperature: opts.temperature ?? 0,
    maxOutputTokens: opts.maxOutputTokens ?? 2048,
  };
  // A schema without the JSON mime type is ignored by the API, so asking for a
  // schema implies JSON mode rather than failing quietly (MISRA-spirit: no
  // silently-dropped request field).
  if (opts.responseMimeType) cfg.responseMimeType = opts.responseMimeType;
  else if (opts.responseSchema) cfg.responseMimeType = "application/json";
  if (opts.responseSchema) cfg.responseSchema = opts.responseSchema;
  return cfg;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export async function generate(opts: GenerateOptions): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError("GEMINI_API_KEY is not set (server-side env only).");
  }
  const model = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: generationConfig(opts),
  };
  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }

  // The key goes in the x-goog-api-key header, never the URL: query strings get
  // logged by proxies/CDNs and can leak into Gemini access logs.
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GeminiError(`Gemini HTTP ${res.status}: ${detail.slice(0, 400)}`, res.status);
  }

  const data = (await res.json()) as GeminiResponse;
  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const finish = data.candidates?.[0]?.finishReason;
  if (finish === "SAFETY" || finish === "RECITATION") {
    throw new GeminiError(`Gemini response blocked (${finish}).`);
  }
  const usage = data.usageMetadata ?? {};
  return {
    text,
    usage: {
      promptTokens: usage.promptTokenCount ?? 0,
      candidatesTokens: usage.candidatesTokenCount ?? 0,
    },
  };
}

/**
 * Streaming twin of `generate`: same auth, same URL shape, same error style, but
 * hits `:streamGenerateContent?alt=sse` and hands back the RAW SSE byte stream
 * so the caller can forward tokens to the browser as they arrive.
 *
 * Deliberately raw and un-parsed: this module owns the transport (key handling,
 * HTTP failures), while the route owns the protocol translation (Gemini SSE →
 * our own SSE) and the persistence/fallback decisions. Nothing here buffers the
 * whole response, so time-to-first-token stays low.
 *
 * Throws `GeminiError` before any byte is read when the key is missing or the
 * upstream rejects the request — that is what lets a caller fall back to the
 * non-streaming `generate` path with its headers still unsent.
 */
export async function streamGenerate(opts: GenerateOptions): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError("GEMINI_API_KEY is not set (server-side env only).");
  }
  const model = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  // `alt=sse` is a transport switch, not a secret: the key still travels in the
  // x-goog-api-key header so it never lands in a proxy/CDN access log.
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: generationConfig(opts),
  };
  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GeminiError(`Gemini HTTP ${res.status}: ${detail.slice(0, 400)}`, res.status);
  }
  if (!res.body) {
    throw new GeminiError("Gemini stream returned no body.", res.status);
  }
  return res.body;
}

interface GeminiEmbedResponse {
  embeddings?: { values?: number[] }[];
  usageMetadata?: { promptTokenCount?: number };
}

/**
 * Batch embedding for dense RAG retrieval. One HTTP call embeds every supplied
 * text (a module's chunks), so synthesis makes a single embedding round-trip
 * instead of one per chunk. Returns one vector per input, in input order.
 *
 * Callers MUST treat this as best-effort: on any failure (missing key, upstream
 * error, surprise shape) they fall back to lexical retrieval and store an empty
 * embedding — dense retrieval improves grounding, it must never gate the module.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError("GEMINI_API_KEY is not set (server-side env only).");
  }
  if (texts.length === 0) return [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`;

  const body = {
    requests: texts.map((text) => ({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
    })),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GeminiError(`Gemini embed HTTP ${res.status}: ${detail.slice(0, 400)}`, res.status);
  }

  const data = (await res.json()) as GeminiEmbedResponse;
  const emb = data.embeddings ?? [];
  if (emb.length !== texts.length || emb.some((e) => !Array.isArray(e.values))) {
    throw new GeminiError("Gemini embed returned an unexpected shape.", res.status);
  }
  return emb.map((e) => e.values as number[]);
}

/** Prompt-token cost of an embedding batch, for the AIUsage panel (no output). */
export function embedUsage(data: unknown): GeminiUsage {
  const meta = (data as GeminiEmbedResponse | undefined)?.usageMetadata;
  return { promptTokens: meta?.promptTokenCount ?? 0, candidatesTokens: 0 };
}
