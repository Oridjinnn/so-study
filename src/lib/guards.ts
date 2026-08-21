// Input-length guards for the AI-facing API routes (rules I3, I7, I8).
//
// Contract: every route that spends a Gemini call validates the SIZE of its
// inputs before making that call. Oversized input is rejected with HTTP 413 and
// an explicit, actionable message — never silently truncated, because silent
// truncation quietly drops the context a grounded answer depends on (I5) and
// hides runaway cost (R4). Fail fast with a clear message (I8).
//
// The numbers are ceilings against runaway prompts, not style rules: a real
// study-sized input (a module of ~4k output tokens ≈ 16k characters, an essay of
// a few thousand words) stays far inside them. Keeping them here — one table,
// server-side, no magic numbers inline — is what makes the bound auditable (I7).

/** HTTP status used for every length rejection: 413 Content Too Large. */
export const GUARD_STATUS = 413;

export const LIMITS = {
  /** Raw request body ceiling, bytes (checked from Content-Length). */
  bodyBytes: 2_000_000,
  /** One Q&A question. */
  question: 4_000,
  /** Number of module chunks injected into a Q&A prompt. */
  chunkCount: 200,
  /** All injected chunks combined — the RAG context budget, characters. */
  chunksTotal: 80_000,
  /** Essay answer submitted for grading (~3.000 words). */
  studentAnswer: 20_000,
  /** Essay question text. */
  questionText: 4_000,
  /** Grading rubric. */
  rubric: 8_000,
  /** Module markdown handed to MCQ generation. */
  moduleText: 80_000,
  /** Topic title used in the synthesis prompt. */
  title: 300,
  /** Approved papers per synthesis — bounds the corpus in the prompt. */
  paperCount: 30,
  /** Keywords supplied to retrieval. */
  keywordCount: 20,
  /** Total characters across all keywords. */
  keywordChars: 1_000,
  /** Pasted official RPS order, characters (a semester is ~16 short lines). */
  rpsText: 20_000,
  /** Topics in one pasted official order. */
  rpsTopicCount: 100,
  /** Course names in one batch import (a semester is well under this). */
  courseBatchCount: 50,
  /** One course name (`Course.name`). */
  courseName: 200,
} as const;

export type GuardUnit = "karakter" | "item" | "bita";

export interface GuardError {
  /** Machine-readable field name, e.g. "question". */
  field: string;
  /** The ceiling that was exceeded. */
  limit: number;
  /** The measured size of the offending input. */
  actual: number;
  unit: GuardUnit;
  /** User-facing message; routes return it as `{ error }`. */
  error: string;
}

function tooLarge(
  field: string,
  label: string,
  actual: number,
  limit: number,
  unit: GuardUnit,
): GuardError {
  // "terlalu banyak" reads correctly for a count, "terlalu besar" for a size.
  const verb = unit === "item" ? "terlalu banyak" : "terlalu besar";
  return {
    field,
    limit,
    actual,
    unit,
    error:
      `${label} ${verb}: ${actual} ${unit} (maksimum ${limit}). ` +
      `Pendekkan atau pecah dulu, lalu coba lagi.`,
  };
}

/**
 * Rejects an already-measured character count larger than `limit`. Used for
 * aggregates (e.g. all RAG chunks combined) where there is no single string.
 */
export function guardChars(
  field: string,
  label: string,
  actual: number,
  limit: number,
): GuardError | null {
  return actual > limit ? tooLarge(field, label, actual, limit, "karakter") : null;
}

/** Rejects a string longer than `limit` characters. Returns null when it fits. */
export function guardLength(
  field: string,
  label: string,
  value: string | null | undefined,
  limit: number,
): GuardError | null {
  return guardChars(field, label, value?.length ?? 0, limit);
}

/** Rejects a collection with more than `limit` entries. Returns null when it fits. */
export function guardCount(
  field: string,
  label: string,
  count: number,
  limit: number,
): GuardError | null {
  return count > limit ? tooLarge(field, label, count, limit, "item") : null;
}

/**
 * Rejects a request whose declared Content-Length exceeds `limit` bytes. A
 * missing or unparseable header is not a violation (the field guards below
 * still bound the actual payload) — we never guess a size we were not told.
 */
export function guardBodyBytes(
  contentLength: string | null | undefined,
  limit: number = LIMITS.bodyBytes,
): GuardError | null {
  if (contentLength == null || contentLength === "") return null;
  const bytes = Number(contentLength);
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  return bytes > limit ? tooLarge("body", "Isi permintaan", bytes, limit, "bita") : null;
}

/**
 * Returns the first violation in evaluation order, or null when every check
 * passed. Order matters: routes list their cheapest/most specific check first
 * so the message points at the field the student can actually shorten.
 */
export function firstGuardError(
  ...errors: (GuardError | null)[]
): GuardError | null {
  for (const e of errors) {
    if (e) return e;
  }
  return null;
}

/** Total character length of the injected RAG chunks. */
export function totalLength(values: string[]): number {
  return values.reduce((sum, v) => sum + v.length, 0);
}
