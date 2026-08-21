"use client";

import { useMemo, useState } from "react";
import type { ProgressData } from "../lib/types";
import { DAILY_REMINDER_MESSAGE, jakartaDateKey, shouldRemind } from "../lib/soso";

const DISMISS_PREFIX = "soso.reminderDismissed:";

function dismissalKey(): string {
  // Per Jakarta-day key so the dismissal resets the next morning.
  return DISMISS_PREFIX + jakartaDateKey();
}

/**
 * Dismissible Soso banner shown when the student hasn't studied "today" yet
 * (latest heatmap entry count == 0) but has topics to study. Persists the
 * dismissal per Jakarta-day in localStorage so it doesn't nag all day.
 */
export default function SosoReminder({ progress }: { progress: ProgressData | null }) {
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem(dismissalKey()) === "1",
  );

  const shouldShow = useMemo(() => shouldRemind(progress), [progress]);

  if (!shouldShow || dismissed) return null;

  function dismiss() {
    try {
      localStorage.setItem(dismissalKey(), "1");
    } catch {
      /* storage unavailable — the banner simply shows again, non-fatal */
    }
    setDismissed(true);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="soso-fade mb-4 flex items-start gap-3 rounded-card border border-brand-500/30 bg-brand-500/10 px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-link">Soso</p>
        <p className="mt-0.5 text-sm leading-relaxed text-foreground">
          {DAILY_REMINDER_MESSAGE}
        </p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Tutup pengingat Soso"
        className="tap min-h-11 min-w-11 rounded-card px-2 text-muted transition hover:bg-brand-500/10 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
      >
        ✕
      </button>
    </div>
  );
}
