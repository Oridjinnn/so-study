import type { ProgressData } from "./types";

/**
 * Soso persona — pure, deterministic message builders. No AI call, no React, no
 * side effects: the in-app reminder and the onboarding wizard both import from
 * here so Soso's voice stays consistent in one place.
 */

/** The canonical daily reminder — exactly as specified by the brief. */
export const DAILY_REMINDER_MESSAGE =
  "Hallo! Soso disini! Kamu belum belajar hari ini! hummft kamu ga kangen aku ya?!";

/** Alternative playful tones Soso can use (kept deterministic, no emoji). */
export const DAILY_REMINDER_VARIANTS: readonly string[] = [
  "Hai! Soso nih. Hari ini belum belajar ya? Yuk, buka satu topik biar otaknya gerak!",
  "Hei, Soso di sini. Belum belajar hari ini? Bentar aja, lima menit juga berasa kok!",
  "Psst, Soso nih. Kamu belum belajar hari ini lho. Ayo, jangan ditinggal jadi penasaran!",
];

/** "Studied today" = the latest heatmap entry (last = today, Asia/Jakarta) has count > 0. */
export function studiedToday(progress: ProgressData | null): boolean {
  const last = progress?.heatmap?.at(-1);
  return (last?.count ?? 0) > 0;
}

/** True when there is actual content left to study (non-empty topic list). */
export function hasContentToStudy(progress: ProgressData | null): boolean {
  return (progress?.topics.length ?? 0) > 0;
}

/** Show the reminder only when not studied today AND there is something to study. */
export function shouldRemind(progress: ProgressData | null): boolean {
  return !studiedToday(progress) && hasContentToStudy(progress);
}

/** Stable index from a date so variants rotate predictably day-to-day. */
export function dailyVariantIndex(now: Date = new Date()): number {
  const day = jakartaDateKey(now);
  let hash = 0;
  for (let i = 0; i < day.length; i += 1) hash = (hash * 31 + day.charCodeAt(i)) | 0;
  return Math.abs(hash) % DAILY_REMINDER_VARIANTS.length;
}

/** A playful alternative tone for today (deterministic per Jakarta day). */
export function dailyReminderVariant(now: Date = new Date()): string {
  return DAILY_REMINDER_VARIANTS[dailyVariantIndex(now)];
}

/** Asia/Jakarta calendar date (YYYY-MM-DD, en-CA ordering) for per-day keys. */
export function jakartaDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// ---------------------------------------------------------------------------
// Push-notification copy (iOS web push). Playful, teasing, never guilt-tripping
// or shame-based — the same wink on a 5-day streak as on day 1. A small rotating
// bank so the reminder doesn't feel robotic; `lastNotificationCopyId` is checked
// so the same line is never sent twice in a row.
// ---------------------------------------------------------------------------

interface PushTemplate {
  id: string;
  /** Build the body, personalizing with the student's name when present. */
  body: (name?: string) => string;
}

const PUSH_TEMPLATES: readonly PushTemplate[] = [
  {
    id: "soso.push.1",
    body: () =>
      "Halo! Soso di sini! Kamu belum belajar hari ini, hummft, kamu nggak kangen aku ya?!",
  },
  {
    id: "soso.push.2",
    body: (name) =>
      name ? `Woy, ${name}! Modulmu nungguin kamu dari tadi, nih.` : "Woy! Modulmu nungguin kamu dari tadi, nih.",
  },
  {
    id: "soso.push.3",
    body: () =>
      "Psst — 5 menit aja buat baca modul hari ini? Soso janji nggak rewel lagi kalau kamu udah mulai.",
  },
  {
    id: "soso.push.4",
    body: () =>
      "Kelasmu makin deket, lho. Yuk baca dulu biar nggak mulai dari nol pas di kelas.",
  },
];

export interface PushCopy {
  copyId: string;
  title: string;
  body: string;
}

/**
 * Pick a push copy line, personalizing line 2 with `studentName` when present
 * (falls back to the generic form otherwise — same pattern as the Soso greeting)
 * and guaranteeing the chosen id differs from `lastCopyId` so the bank rotates.
 */
export function pickPushCopy(
  studentName?: string | null,
  lastCopyId?: string | null,
): PushCopy {
  const candidates = PUSH_TEMPLATES.filter((t) => t.id !== lastCopyId);
  const pool = candidates.length > 0 ? candidates : PUSH_TEMPLATES;
  const choice = pool[Math.floor(Math.random() * pool.length)];
  return { copyId: choice.id, title: "Soso", body: choice.body(studentName ?? undefined) };
}
