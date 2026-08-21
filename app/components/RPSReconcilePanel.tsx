"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import Modal from "./Modal";
import type { RPSDiffRow, RPSState } from "../lib/types";
import { extractPdfText } from "../lib/pdfExtract";

/**
 * RPS reconciliation (Risk Register R1: "Topic order mismatches real lecturer
 * sequence", High/High).
 *
 * The student normally starts studying in a self-chosen order and only later
 * receives the official RPS/syllabus, so this is an after-the-fact comparison:
 * paste the lecturer's order, see which topics you studied out of sequence and
 * which ones you have not started at all.
 */

const STATUS_LABEL: Record<RPSDiffRow["status"], string> = {
  aligned: "Urutan cocok",
  moved: "Beda posisi",
  not_in_official: "Tidak ada di RPS",
  not_started: "Belum dibuat",
};

const STATUS_CLASS: Record<RPSDiffRow["status"], string> = {
  aligned:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  moved: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
  not_in_official: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  not_started: "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-200",
};

function positionLabel(row: RPSDiffRow): string {
  const official = row.officialPosition == null ? "—" : `#${row.officialPosition}`;
  const custom = row.customPosition == null ? "—" : `#${row.customPosition}`;
  if (row.delta == null || row.delta === 0) return `RPS ${official} · milikmu ${custom}`;
  const direction = row.delta > 0 ? "lebih lambat" : "lebih awal";
  return `RPS ${official} · milikmu ${custom} (${Math.abs(row.delta)} posisi ${direction})`;
}

export default function RPSReconcilePanel({
  courseId,
  onClose,
  onReconciled,
}: {
  courseId: string;
  onClose: () => void;
  /** Fired after a successful save so the dashboard badges can refresh. */
  onReconciled?: () => void;
}) {
  const [state, setState] = useState<RPSState | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [pdfNote, setPdfNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rps/${encodeURIComponent(courseId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const next = data as RPSState;
      setState(next);
      setDraft(next.officialOrder.join("\n"));
      // Nothing saved yet: go straight to the input, since an empty diff view
      // would be a dead end for a first-time reconcile.
      setEditing(!next.hasOfficialOrder);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  // Same shape as ReviewQueue's loader: the fetch is deferred past the
  // synchronous effect body (and guarded by `active`) so mounting the panel does
  // not set state during the effect itself.
  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/rps/${encodeURIComponent(courseId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officialOrder: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState(data as RPSState);
      setEditing(false);
      onReconciled?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePdf(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setError(null);
    setPdfNote(null);
    try {
      const text = await extractPdfText(file);
      if (!text.trim()) {
        setPdfNote(
          "Tidak ada teks yang bisa diekstrak (mungkin PDF hasil scan). Isi manual di kotak di bawah.",
        );
      } else {
        setDraft(text);
        setPdfNote("Teks dari PDF sudah diisi — review & sunting sebelum simpan.");
      }
    } catch {
      setError("Gagal membaca PDF. Pastikan file tidak rusak.");
    } finally {
      setExtracting(false);
      // Allow re-uploading the same file later.
      e.target.value = "";
    }
  }

  return (
    <Modal
      open
      title="Cocokkan urutan RPS"
      onClose={onClose}
      labelledById="rps-title"
      className="max-w-2xl max-h-[85vh]"
    >
      <div className="flex flex-col">
        <div className="border-b border-border p-4">
          <h2 id="rps-title" className="text-lg font-semibold">
            Cocokkan urutan RPS
          </h2>
          <p className="mt-1 text-sm text-muted">
            Tempel urutan topik resmi dari dosen/RPS. So-study membandingkannya
            dengan urutan yang kamu pelajari, supaya kamu tahu topik mana yang
            keluar dari barisan dosen.
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {error && (
            <p
              role="alert"
              className="rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </p>
          )}

          {loading && <p className="text-sm text-muted">Memuat…</p>}

          {!loading && editing && (
            <div>
              <label htmlFor="rps-pdf" className="block text-sm font-medium">
                Unggah PDF RPS / kalender akademik{" "}
                <span className="font-normal text-muted">(opsional)</span>
              </label>
              <input
                id="rps-pdf"
                type="file"
                accept="application/pdf"
                disabled={extracting}
                onChange={handlePdf}
                className="tap mt-1 block w-full text-sm"
              />
              <p className="mt-1 text-xs text-muted">
                File kamu sendiri (tidak di-scrape). Teks diekstrak ke kotak di bawah untuk
                kamu review &amp; sunting — belum otomatis tersimpan.
              </p>
              {extracting && (
                <p className="mt-1 text-xs text-muted">Mengekstrak teks PDF…</p>
              )}
              {pdfNote && (
                <p
                  role="status"
                  className="mt-1 text-xs text-brand-600 dark:text-brand-400"
                >
                  {pdfNote}
                </p>
              )}

              <label htmlFor="rps-order" className="mt-4 block text-sm font-medium">
                Urutan resmi (satu topik per baris)
              </label>
              <textarea
                id="rps-order"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                placeholder={"1. Pengantar Antropologi\n2. Evolusi Kebudayaan\n3. Strukturalisme"}
                className="tap mt-1 w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:bg-zinc-800"
              />
              <p className="mt-1 text-xs text-muted">
                Nomor urut, tanda hubung, dan awalan &ldquo;Minggu 3:&rdquo; otomatis
                dibersihkan. Pisahkan dengan baris baru (bukan koma — banyak judul
                topik memuat koma).
              </p>
            </div>
          )}

          {!loading && !editing && state && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_CLASS.aligned}`}>
                  {state.summary.aligned} cocok
                </span>
                <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_CLASS.moved}`}>
                  {state.summary.moved} beda posisi
                </span>
                <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_CLASS.not_started}`}>
                  {state.summary.notStarted} belum dibuat
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_CLASS.not_in_official}`}
                >
                  {state.summary.notInOfficial} di luar RPS
                </span>
              </div>

              <ul className="space-y-2">
                {state.rows.map((row, i) => (
                  <li
                    key={`${row.topicId ?? "official"}-${i}`}
                    className="flex items-start justify-between gap-3 rounded-card border border-border bg-card px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.title}</p>
                      <p className="text-xs text-muted">{positionLabel(row)}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        STATUS_CLASS[row.status]
                      }`}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                  </li>
                ))}
              </ul>

              {state.rows.length === 0 && (
                <p className="text-sm text-muted">
                  Belum ada topik untuk dibandingkan di mata kuliah ini.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4">
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="tap min-h-11 rounded-card border border-border px-3 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Ubah urutan resmi
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
              className="tap min-h-11 rounded-card px-4 py-2 text-sm text-muted transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
          >
            Tutup
          </button>
          {editing && (
            <button
              type="button"
              onClick={save}
              disabled={saving || !draft.trim()}
              className="tap min-h-11 rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Menyimpan…" : "Simpan & bandingkan"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
