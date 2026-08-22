"use client";

import { useEffect, useState } from "react";
import type { UsageRow } from "../lib/types";
import Modal from "./Modal";

const LABELS: Record<string, string> = {
  synthesize: "Sintesis modul",
  qa: "Tanya-jawab",
  grade: "Penilaian esai",
};

// Local copy of the `budget` object returned by GET /api/usage (workstream C).
// Defined here rather than imported from a shared DTO so this component stays
// within its owned file and the API shape change is the single source of truth.
interface BudgetView {
  dailyLimit: number;
  monthlyLimit: number;
  spentToday: number;
  spentThisMonth: number;
  remainingToday: number;
  remainingThisMonth: number;
  blocked: boolean;
  dayResetsAt: string;
  monthResetsAt: string;
  timezone: string;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export default function UsageModal({
  rows,
  onClose,
}: {
  rows: UsageRow[];
  onClose: () => void;
}) {
  const totalCost = rows.reduce((s, r) => s + r.estimatedCost, 0);
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);

  // Pull the budget cap (workstream C) straight from /api/usage. The parent only
  // hands us the per-kind `rows`; the cap is a separate field, so we fetch it
  // ourselves on open. Failures are silent — the cap panel is advisory, the rows
  // below always render.
  const [budget, setBudget] = useState<BudgetView | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/usage")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.budget) setBudget(d.budget as BudgetView);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Modal
      open
      title="Biaya AI"
      onClose={onClose}
      labelledById="usage-title"
      className="max-w-md"
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <h2 id="usage-title" className="text-lg font-semibold">Biaya AI</h2>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-card px-2 py-1 text-muted transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
          >
            ✕
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-800/60">
            <div className="text-xs text-muted">Total panggilan</div>
            <div className="text-xl font-semibold">{totalCalls}</div>
          </div>
          <div className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-800/60">
            <div className="text-xs text-muted">Estimasi (USD)</div>
            <div className="text-xl font-semibold">${totalCost.toFixed(4)}</div>
          </div>
        </div>
        {budget && (
          <div className="mt-3 rounded-xl border border-border p-3">
            <div className="text-xs font-medium text-muted">Batas Anggaran AI (Gemini)</div>
            {budget.blocked ? (
              <p className="mt-1 text-sm font-medium text-red-600 dark:text-red-400">
                Anggaran terlampaui — pemanggilan AI diblokir untuk sementara.
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted">Harian</div>
                  <div className="font-semibold">
                    {money(budget.remainingToday)} / {money(budget.dailyLimit)} tersisa
                  </div>
                  <div className="text-xs text-muted">terpakai {money(budget.spentToday)}</div>
                </div>
                <div>
                  <div className="text-muted">Bulanan</div>
                  <div className="font-semibold">
                    {money(budget.remainingThisMonth)} / {money(budget.monthlyLimit)} tersisa
                  </div>
                  <div className="text-xs text-muted">terpakai {money(budget.spentThisMonth)}</div>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="mt-4 space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted">Belum ada pemakaian.</p>}
          {rows.map((r) => (
            <div
              key={r.kind}
              className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm"
            >
              <span className="font-medium">{LABELS[r.kind] ?? r.kind}</span>
              <span className="text-muted">
                {r.calls}× · {r.tokensIn}/{r.tokensOut} tok · ${r.estimatedCost.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted">
          Estimasi berdasarkan harga listrik Gemini; bukan tagihan resmi.
        </p>
      </div>
    </Modal>
  );
}
