"use client";

import { useState } from "react";
import type { CandidatePaper } from "../lib/types";
import { defaultApprovedIndices, isInternationalJournal } from "@/src/lib/scoring";
import Modal from "./Modal";

/**
 * The human approval gate before synthesis (Risk Register R2/R3). It is NOT
 * skippable: synthesis runs only on papers approved here, and approving nothing
 * is blocked rather than quietly producing an empty module.
 *
 * Friction is reduced, not the safeguard: candidates that clear the retrieval
 * heuristic arrive pre-checked, so the student's job is to *override* a
 * sensible default (uncheck what does not belong) instead of assembling the
 * source list from scratch.
 */
export default function PaperReview({
  topicId,
  title,
  papers,
  busy,
  onConfirm,
  onClose,
}: {
  topicId: string;
  title: string;
  papers: CandidatePaper[];
  busy: boolean;
  onConfirm: (topicId: string, approvedIds: string[]) => void;
  onClose: () => void;
}) {
  // Two distinct situations, deliberately handled differently:
  //  - Revisiting a topic that already has stored approvals -> restore exactly
  //    what the student decided last time. Re-applying the heuristic here would
  //    silently resurrect papers they had excluded on purpose.
  //  - A fresh shortlist (nothing approved yet) -> pre-check what clears the
  //    heuristic threshold.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const stored = papers.filter((p) => p.approved).map((p) => p.id);
    if (stored.length > 0) return new Set(stored);
    return new Set(defaultApprovedIndices(papers).map((i) => papers[i].id));
  });
  // Set once the student tries to continue with an empty selection, so the
  // block is explained instead of appearing as an inert disabled button.
  const [blocked, setBlocked] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBlocked(false);
  }

  const approved = [...selected];
  const excludedCount = papers.length - approved.length;

  // The review must surface a broad, internationally-representative pool: at
  // least 2 international journals written in English or another language. This
  // count is shown so the student can verify the breadth requirement directly.
  const internationalCount = papers.filter((p) => isInternationalJournal(p)).length;
  const internationalMet = internationalCount >= 2;

  function submit() {
    // Never auto-approve nothing into an empty module: the gate blocks with a
    // reason (I8 — assert the precondition, fail with a clear message).
    if (approved.length === 0) {
      setBlocked(true);
      return;
    }
    onConfirm(topicId, approved);
  }

  return (
    <Modal
      open
      title="Tinjau paper"
      onClose={onClose}
      labelledById="paper-review-title"
      className="max-w-lg max-h-[85vh]"
    >
      <div className="flex max-h-[80vh] flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border p-4">
          <h2 id="paper-review-title" className="text-lg font-semibold">
            Tinjau paper ({papers.length})
          </h2>
          <p className="mt-1 text-sm text-muted">
            Topik: {title}. Paper yang lolos ambang relevansi sudah dicentang —
            hilangkan centang bila ada yang tidak cocok, lalu lanjut.
          </p>
          <p
            className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
              internationalMet
                ? "bg-brand-500/15 text-link"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            }`}
            title="Syarat kedalaman so-study: minimal 2 jurnal internasional (Inggris/lainnya)"
          >
            Jurnal internasional: {internationalCount}/2
            {internationalMet ? " ✓" : " — kurang"}
          </p>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {papers.map((p) => {
            const intl = isInternationalJournal(p);
            return (
            <label
              key={p.id}
              className="flex cursor-pointer gap-3 rounded-xl border border-border p-3"
            >
              <input
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                className="mt-1 h-4 w-4 accent-brand-600"
              />
               <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {p.title}
                    {intl && (
                      <span className="shrink-0 rounded bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-link">
                        Jurnal intl.
                      </span>
                    )}
                  </p>
                   <p className="truncate text-xs text-muted">
                    {p.authors || "—"} · {p.year} · {p.citationCount} sitasi · rel {p.relevanceScore}
                    {p.language ? ` · ${p.language.toUpperCase()}` : ""}
                  </p>
                  {p.abstract && (
                   <p className="mt-1 line-clamp-2 text-xs text-muted">{p.abstract}</p>
                 )}
                 <a
                  href={p.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-link hover:underline"
                >
                  {p.fullTextAvailable ? "Open access" : "Sumber"}
                </a>
              </div>
            </label>
            );
          })}
        </div>

        <div className="shrink-0 space-y-2 border-t border-border p-4">
          {blocked && (
            <p
              role="alert"
              className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            >
              Pilih minimal satu paper. Modul disusun hanya dari paper yang Anda
              setujui, jadi tanpa paper tidak ada sumber untuk disintesis.
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {approved.length} dipilih
              {excludedCount > 0 ? ` · ${excludedCount} dikecualikan` : ""}
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="tap min-h-11 rounded-xl px-4 py-2 text-sm font-medium text-muted transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
              >
                Batal
              </button>
              <button
                onClick={submit}
                disabled={busy}
                className="tap min-h-11 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50"
              >
                {busy ? "Menyusun…" : `Approve & lanjut (${approved.length})`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
