"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The immediate, visible loading state for the two slow steps in the flow
 * (paper retrieval ~10s, module synthesis longer). Both used to leave the UI
 * looking frozen: the only feedback was an `sr-only` live region, so a sighted
 * student saw nothing at all between pressing the button and the next screen
 * appearing. A frozen UI reads as broken, not slow.
 *
 * Three deliberate choices:
 *   1. It mounts the moment the request is fired, with a skeleton shaped like
 *      the screen that is coming (passed as `children`).
 *   2. The label advances through `stages` on a timer. This is staged, not
 *      measured, progress — honest wording ("Menilai relevansi…") that reflects
 *      what the server is actually doing in sequence, and it stops on the last
 *      stage instead of looping, because a looping label looks like a stall.
 *   3. When REAL progress exists (the synthesis SSE stream reports characters
 *      written), pass it as `detail`; it replaces the staged text, so measured
 *      progress always wins over the guess.
 *
 * Zero dependencies: one timer, Tailwind classes, `prefers-reduced-motion`
 * honoured by the `motion-reduce:animate-none` utilities on the pulse.
 */
export interface LoadingPanelProps {
  /** Heading; states what is happening, e.g. "Mencari paper untuk topik ini…". */
  title: string;
  /** Staged labels, shown in order. The last one stays until the panel unmounts. */
  stages: readonly string[];
  /** Milliseconds per stage. 2500ms keeps the text alive without flickering. */
  stageMs?: number;
  /** Real, measured progress. When set, it wins over the staged label. */
  detail?: string | null;
  /** Skeleton of the screen being loaded. */
  children?: ReactNode;
}

export default function LoadingPanel({
  title,
  stages,
  stageMs = 2500,
  detail,
  children,
}: LoadingPanelProps) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    // Nothing to advance through: a single-stage panel needs no timer at all.
    if (stages.length <= 1) return;
    const id = setInterval(() => {
      // Clamp at the final stage — never wrap around to stage 1, which would
      // read as "it started over" to a student already waiting.
      setStage((s) => (s + 1 < stages.length ? s + 1 : s));
    }, stageMs);
    return () => clearInterval(id);
    // The panel is mounted per wait (and unmounted when it ends), so the stage
    // counter starts at 0 by construction — no in-effect reset needed.
  }, [stages, stageMs]);

  const label = detail?.trim() ? detail.trim() : (stages[stage] ?? "");

  return (
    <div
      className="load-overlay fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 backdrop-blur-[1px] sm:items-center"
      // Not a dialog: nothing here is actionable and nothing may be dismissed,
      // so it must not trap focus. It is a live status region.
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="load-card w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="mb-1 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand-500 border-t-transparent motion-reduce:animate-none"
          />
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <p className="mb-4 text-sm text-muted transition-opacity duration-200">{label}</p>

        {/* Stage dots: a compact, non-numeric sense of "how far along". */}
        {stages.length > 1 && (
          <div aria-hidden="true" className="mb-4 flex gap-1.5">
            {stages.map((s, i) => (
              <span
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
                  i <= stage ? "bg-brand-500" : "bg-zinc-200 dark:bg-zinc-700"
                }`}
              />
            ))}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
