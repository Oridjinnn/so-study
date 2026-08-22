"use client";

// Bank soal — the generation effect: students write their own recall items
// (Dunlosky et al. 2013; the act of composing a question is itself retrieval).
// AI-generated items (`author: "ai"`, persisted by the Latih tab) show up here
// read-only, so the same pool feeds Bank Soal and the interleaved practice.

import { useEffect, useState } from "react";
import type { QuestionBankItem } from "../lib/types";
import { apiFetch } from "../lib/api";
import Modal from "./Modal";

type Props = {
  topicId: string;
  moduleId: string;
  /** Bump to re-read the bank (e.g. after AI questions were persisted). */
  reloadKey?: number;
};

async function sendJSON<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await apiFetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

const INPUT_CLASS =
  "w-full rounded-card border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:bg-zinc-800";
const PRIMARY_CLASS =
  "tap min-h-11 rounded-card bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50";
const SECONDARY_CLASS =
  "tap min-h-11 rounded-card border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800";

export default function QuestionBank({ topicId, moduleId, reloadKey = 0 }: Props) {
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [stem, setStem] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/questions?topicId=${encodeURIComponent(topicId)}`)
      .then((r) => r.json())
      .then((data: { items?: QuestionBankItem[]; error?: string }) => {
        if (cancelled) return;
        if (data.items) setItems(data.items);
        else setError(data.error ?? "Gagal memuat bank soal.");
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [topicId, reloadKey]);

  const studentItems = items.filter((i) => i.author === "student");
  const aiItems = items.filter((i) => i.author === "ai");
  const pendingDelete = items.find((i) => i.id === confirmDeleteId) ?? null;

  async function addItem() {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!stem.trim()) {
      setError("Tulis soal (stem) dulu.");
      return;
    }
    if (opts.length < 2) {
      setError("Minimal 2 opsi.");
      return;
    }
    if (!answer.trim() || !opts.includes(answer.trim())) {
      setError("Pilih salah satu opsi sebagai jawaban.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const created = await sendJSON<QuestionBankItem>("/api/questions", "POST", {
        topicId,
        moduleId,
        stem: stem.trim(),
        options: opts,
        answer: answer.trim(),
        explanation: explanation.trim() || undefined,
      });
      setItems((prev) => [...prev, created]);
      setStem("");
      setOptions(["", ""]);
      setAnswer("");
      setExplanation("");
      setStatus("Soal tersimpan di bank soal Anda.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function updateItem(id: string, patch: Record<string, unknown>) {
    setError(null);
    try {
      const updated = await sendJSON<QuestionBankItem>(
        `/api/questions?id=${encodeURIComponent(id)}`,
        "PATCH",
        patch,
      );
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
      setStatus("Perubahan soal tersimpan.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Destructive: confirmed in an accessible dialog (Modal traps focus and is
  // announced), never `window.confirm`.
  async function removeItem(id: string) {
    setError(null);
    setConfirmDeleteId(null);
    try {
      await sendJSON<{ ok: boolean }>(`/api/questions?id=${encodeURIComponent(id)}`, "DELETE", {});
      setItems((prev) => prev.filter((i) => i.id !== id));
      setStatus("Soal dihapus.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function setOptionAt(idx: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? value : o)));
  }
  function addOptionField() {
    if (options.length < 4) setOptions((prev) => [...prev, ""]);
  }
  function removeOptionField(idx: number) {
    if (options.length <= 2) return;
    const removed = options[idx];
    setOptions((prev) => prev.filter((_, i) => i !== idx));
    if (answer === removed) setAnswer("");
  }

  return (
    <section className="space-y-6">
      <header>
        <h3 className="text-lg font-semibold">Bank soal</h3>
        <p className="text-sm text-muted">
          Efek generasi: buat sendiri soal recall untuk topik ini. Soal buatan Anda bisa diedit &amp;
          dihapus; soal AI hanya bisa dipraktikkan.
        </p>
      </header>

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {loading ? (
        <p role="status" className="text-sm text-muted">
          Memuat bank soal…
        </p>
      ) : (
        <>
          {studentItems.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-link">
                Saya ({studentItems.length})
              </h4>
              <div className="space-y-3">
                {studentItems.map((it) => (
                  <StudentItemCard
                    key={it.id}
                    item={it}
                    onUpdate={updateItem}
                    onDelete={setConfirmDeleteId}
                  />
                ))}
              </div>
            </div>
          )}

          {aiItems.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold text-muted">AI ({aiItems.length})</h4>
              <div className="space-y-3">
                {aiItems.map((it) => (
                  <ReadOnlyCard key={it.id} item={it} />
                ))}
              </div>
            </div>
          )}

          {items.length === 0 && (
            <p className="text-sm text-muted">Belum ada soal. Buat soal pertama Anda di bawah.</p>
          )}
        </>
      )}

      <div className="rounded-card border border-border bg-card p-4">
        <h4 className="mb-3 font-semibold">Tambah soal</h4>
        <textarea
          value={stem}
          onChange={(e) => setStem(e.target.value)}
          rows={2}
          placeholder="Pertanyaan (stem)…"
          className={INPUT_CLASS}
        />
        <div className="mt-3 space-y-2">
          {options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="radio"
                name="new-answer"
                checked={answer === opt.trim() && opt.trim() !== ""}
                onChange={() => opt.trim() && setAnswer(opt.trim())}
                disabled={!opt.trim()}
                title="Jadikan jawaban"
                className="h-4 w-4 accent-emerald-600"
              />
              <input
                value={opt}
                onChange={(e) => setOptionAt(idx, e.target.value)}
                placeholder={`Opsi ${idx + 1}`}
                className={`flex-1 ${INPUT_CLASS}`}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOptionField(idx)}
                  className="tap min-h-11 rounded-card px-2 text-muted transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
                  title="Hapus opsi"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {options.length < 4 && (
            <button
              type="button"
              onClick={addOptionField}
              className="text-xs font-medium text-link hover:underline focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              + Tambah opsi
            </button>
          )}
        </div>
        <input
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          placeholder="Penjelasan (opsional)"
          className={`mt-3 ${INPUT_CLASS}`}
        />
        <button type="button" onClick={addItem} disabled={adding} className={`mt-3 ${PRIMARY_CLASS}`}>
          {adding ? "Menyimpan…" : "Simpan soal"}
        </button>
      </div>

      {pendingDelete && (
        <Modal
          open
          title="Hapus soal ini?"
          onClose={() => setConfirmDeleteId(null)}
          className="max-w-sm"
        >
          <div className="space-y-3 px-4 py-4 text-sm">
            <p className="text-muted">
              &ldquo;{pendingDelete.stem}&rdquo; akan dihapus permanen. Tindakan ini tidak bisa
              dibatalkan.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className={SECONDARY_CLASS}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => removeItem(pendingDelete.id)}
                className="tap min-h-11 rounded-card bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              >
                Hapus soal
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function StudentItemCard({
  item,
  onUpdate,
  onDelete,
}: {
  item: QuestionBankItem;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [stem, setStem] = useState(item.stem);
  const [options, setOptions] = useState<string[]>(item.options);
  const [answer, setAnswer] = useState(item.answer);
  const [explanation, setExplanation] = useState(item.explanation ?? "");
  const [saving, setSaving] = useState(false);

  function setOptionAt(idx: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? value : o)));
  }

  async function save() {
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!stem.trim() || opts.length < 2 || !answer.trim() || !opts.includes(answer.trim())) {
      return;
    }
    setSaving(true);
    try {
      await onUpdate(item.id, {
        stem: stem.trim(),
        options: opts,
        answer: answer.trim(),
        explanation: explanation.trim() || undefined,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-card border border-border bg-card p-3">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={stem}
            onChange={(e) => setStem(e.target.value)}
            rows={2}
            className={INPUT_CLASS}
          />
          {options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="radio"
                name={`ans-${item.id}`}
                checked={answer === opt.trim() && opt.trim() !== ""}
                onChange={() => opt.trim() && setAnswer(opt.trim())}
                disabled={!opt.trim()}
                className="h-4 w-4 accent-emerald-600"
              />
              <input
                value={opt}
                onChange={(e) => setOptionAt(idx, e.target.value)}
                className={`flex-1 ${INPUT_CLASS}`}
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => {
                    const removed = options[idx];
                    setOptions((prev) => prev.filter((_, i) => i !== idx));
                    if (answer === removed) setAnswer("");
                  }}
                  className="tap min-h-11 rounded-card px-2 text-muted transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:hover:bg-zinc-800"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {options.length < 4 && (
            <button
              type="button"
              onClick={() => setOptions((prev) => [...prev, ""])}
              className="text-xs font-medium text-link hover:underline focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              + Tambah opsi
            </button>
          )}
          <input
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            placeholder="Penjelasan (opsional)"
            className={INPUT_CLASS}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="tap min-h-11 rounded-card bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none disabled:opacity-50"
            >
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStem(item.stem);
                setOptions(item.options);
                setAnswer(item.answer);
                setExplanation(item.explanation ?? "");
                setEditing(false);
              }}
              className={SECONDARY_CLASS}
            >
              Batal
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium">{item.stem}</p>
          <OptionList item={item} />
          {item.explanation && <p className="mt-2 text-xs text-muted">{item.explanation}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing(true)} className={SECONDARY_CLASS}>
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="tap min-h-11 rounded-card border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              Hapus
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OptionList({ item }: { item: QuestionBankItem }) {
  return (
    <ul className="mt-2 space-y-1">
      {item.options.map((opt) => {
        const isAnswer = opt === item.answer;
        return (
          <li
            key={opt}
            className={`rounded-card border px-2 py-1 text-sm ${
              isAnswer
                ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/40"
                : "border-border"
            }`}
          >
            {opt}
            {isAnswer && (
              <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                jawaban
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReadOnlyCard({ item }: { item: QuestionBankItem }) {
  return (
    <div className="rounded-card border border-border bg-card p-3">
      <p className="text-sm font-medium">{item.stem}</p>
      <OptionList item={item} />
      {item.explanation && <p className="mt-2 text-xs text-muted">{item.explanation}</p>}
    </div>
  );
}
