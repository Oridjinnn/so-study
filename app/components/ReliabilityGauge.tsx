"use client";

import { useState, useEffect, useRef } from "react";
import type { GaugeBand, VerificationPayload } from "../lib/types";
import { apiFetch } from "../lib/api";
import { bandLabel } from "@/src/lib/gauge";
import { MAX_REPAIR_ATTEMPTS } from "@/src/lib/repair";
import { CHIP_CLASS } from "./ui";

/**
 * Reliability gauge — a needle PLUS its labelled breakdown, never a bare number.
 *
 * Two rules this component exists to enforce, both of them about honesty rather
 * than looks:
 *   1. The composite score is always rendered together with the components that
 *      produced it (`gauge.breakdownLines`) and with the caveat that says what it
 *      measures (`gauge.caveat`). The caveat is body text, not a tooltip: a
 *      warning nobody opens is a warning nobody read, and overclaiming precision
 *      here would be worse than shipping no gauge at all.
 *   2. Colour means CATEGORY, not prettiness. The filled arc takes the colour of
 *      the current band, and each band is a category from the checks themselves —
 *      red = Tier 1 hard fail (phantom citation, module blocked), orange = the AI
 *      critic contradicted a claim, yellow = warnings/uncertain verdicts present
 *      (or Tier 2 never ran), green = both tiers clean.
 *
 * The action follows the same discipline: when there is nothing flagged, there is
 * no "regenerate" button at all — the panel says the module already passed both
 * tiers instead of inviting a costly no-op.
 */

type Props = {
  moduleId: string;
  verification?: VerificationPayload;
  online: boolean;
  /** Fresh payload after a verify/repair call, so the gauge updates in place. */
  onVerification?: (v: VerificationPayload) => void;
  /** New module markdown after a successful targeted repair. */
  onContentChanged?: (markdown: string) => void;
  onError?: (message: string) => void;
};

const BAND_COLOR: Record<GaugeBand, string> = {
  ditahan: "#dc2626", // red-600  — Tier 1 FAIL: phantom citation
  "perlu-tinjau": "#ea580c", // orange-600 — Tier 2 contradicted
  cukup: "#d97706", // amber-600 — WARN / uncertain / Tier 2 not run
  baik: "#16a34a", // green-600 — clean on both tiers
};

const BAND_LEGEND: { band: GaugeBand; meaning: string }[] = [
  { band: "ditahan", meaning: "Tahap 1 gagal: ada sitasi hantu — modul ditahan" },
  { band: "perlu-tinjau", meaning: "Kritikus AI menandai klaim yang kontradiktif" },
  { band: "cukup", meaning: "Ada catatan (WARN Tahap 1 / klaim tidak pasti), atau Tahap 2 belum jalan" },
  { band: "baik", meaning: "Tidak ada temuan di kedua tahap" },
];

const GAUGE = { cx: 100, cy: 92, r: 70 };

function polar(value: number): { x: number; y: number } {
  // 0 → 180° (left), 1 → 0° (right); a half-dial speedometer.
  const rad = ((180 - 180 * Math.min(1, Math.max(0, value))) * Math.PI) / 180;
  return { x: GAUGE.cx + GAUGE.r * Math.cos(rad), y: GAUGE.cy - GAUGE.r * Math.sin(rad) };
}

function arcPath(from: number, to: number): string {
  const a = polar(from);
  const b = polar(to);
  // Always the short way round on a half dial.
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${GAUGE.r} ${GAUGE.r} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export default function ReliabilityGauge({
  moduleId,
  verification,
  online,
  onVerification,
  onContentChanged,
  onError,
}: Props) {
  const [busy, setBusy] = useState<"tier1" | "tier2" | "repair" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [animatedScore, setAnimatedScore] = useState(0);
  const animFrameRef = useRef<number | null>(null);

  const gauge = verification?.gauge ?? null;
  const tier1 = verification?.tier1 ?? null;
  const critic = verification?.critic ?? null;
  const attemptsUsed = verification?.repairAttempts ?? 0;
  const attemptsLeft = Math.max(0, MAX_REPAIR_ATTEMPTS - attemptsUsed);
  const flagged = gauge?.flagCount ?? 0;
  const blocked = Boolean(tier1?.blocked);
  const criticFlags = (critic?.judgments ?? []).filter((j) => j.verdict !== "supported");

  useEffect(() => {
    const target = gauge ? Math.round(gauge.score * 100) : 0;
    const duration = 800;
    const start = performance.now();
    const from = animatedScore;

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    function step(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedScore(Math.round(from + (target - from) * eased));
      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    }

    animFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [gauge?.score]);

  async function post(url: string, body: unknown, kind: "tier1" | "tier2" | "repair") {
    setBusy(kind);
    setNote(null);
    try {
      const res = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        verification?: VerificationPayload;
        changed?: boolean;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.verification) onVerification?.(data.verification);
      if (data.message) setNote(data.message);
      return data;
    } catch (e) {
      onError?.((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function runRepair() {
    const data = await post(`/api/modules/${moduleId}/repair`, {}, "repair");
    if (data?.changed) onContentChanged?.("");
  }

  if (!gauge || !tier1) {
    return (
      <section
        aria-labelledby="gauge-heading"
        className="rounded-card border border-border bg-card p-4 anim-fade-in-up"
      >
        <h3 id="gauge-heading" className="mb-1 font-semibold">
          Keandalan modul
        </h3>
        <p className="mb-3 text-sm text-muted leading-relaxed">
          Modul ini <strong>belum diperiksa</strong>. Belum diperiksa bukan berarti bersih — tidak ada
          skor yang ditampilkan sampai pemeriksaan dijalankan.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => post(`/api/modules/${moduleId}/verify`, {}, "tier1")}
            className={CHIP_CLASS}
          >
            {busy === "tier1" ? "Memeriksa…" : "Periksa Tahap 1 (gratis, tanpa AI)"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !online}
            title={online ? "Menjalankan 1–4 panggilan AI" : "Butuh internet"}
            onClick={() => post(`/api/modules/${moduleId}/verify`, { tier2: true }, "tier2")}
            className={CHIP_CLASS}
          >
            {busy === "tier2" ? "Meninjau…" : "Tahap 1 + tinjauan AI (Tahap 2)"}
          </button>
        </div>
        {note && (
          <p role="status" className="mt-2 text-xs text-muted">
            {note}
          </p>
        )}
      </section>
    );
  }

  const color = BAND_COLOR[gauge.band];
  const needle = polar(gauge.score);
  const scorePct = animatedScore;

  return (
    <section
      aria-labelledby="gauge-heading"
      className="rounded-card border border-border bg-card p-4 anim-fade-in-up"
    >
      <h3 id="gauge-heading" className="mb-2 font-semibold">
        Keandalan modul (Tahap 1 + Tahap 2)
      </h3>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="shrink-0">
          <svg
            viewBox="0 0 200 112"
            width="200"
            height="112"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={scorePct}
            aria-label={`Skor keterhubungan sumber ${scorePct} dari 100 — ${bandLabel(gauge.band)}`}
          >
            {/* Neutral track: the dial is a SCALE, it carries no verdict itself. */}
            <path d={arcPath(0, 1)} fill="none" stroke="#d4d4d8" strokeWidth={12} strokeLinecap="round" />
            {/* Filled portion takes the CURRENT BAND's colour (category, not gradient). */}
            <path
              d={arcPath(0, Math.max(0.001, gauge.score))}
              fill="none"
              stroke={color}
              strokeWidth={12}
              strokeLinecap="round"
            />
            <line
              x1={GAUGE.cx}
              y1={GAUGE.cy}
              x2={needle.x}
              y2={needle.y}
              stroke={color}
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle cx={GAUGE.cx} cy={GAUGE.cy} r={5} fill={color} />
            <text x={GAUGE.cx} y={GAUGE.cy - 18} textAnchor="middle" className="fill-current" fontSize="22" fontWeight="700">
              {scorePct}
            </text>
            <text x={GAUGE.cx} y={GAUGE.cy - 4} textAnchor="middle" className="fill-current" fontSize="9">
              dari 100
            </text>
          </svg>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color }}>
            {bandLabel(gauge.band)}
          </p>
          {/* The formula, always visible — the gauge is a summary OF these lines,
              not a replacement for them. */}
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {gauge.breakdownLines.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Caveat: body text, never a tooltip. */}
      <p className="mt-3 rounded-card bg-zinc-50 p-3 text-xs text-foreground dark:bg-zinc-800/40 leading-relaxed">
        {gauge.caveat}
      </p>

      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted">Arti warna</summary>
        <ul className="mt-1 space-y-1">
          {BAND_LEGEND.map((l) => (
            <li key={l.band} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: BAND_COLOR[l.band] }}
              />
              <span>
                <strong>{bandLabel(l.band)}</strong> — {l.meaning}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {blocked && (
        <div
          role="alert"
          className="mt-3 rounded-card border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          <p className="font-semibold leading-relaxed">Modul ditahan: ada sitasi yang tidak menunjuk paper mana pun.</p>
          <p className="mt-1 text-xs leading-relaxed">
            Pemeriksaan Tahap 1 bersifat deterministik — ini bukan penilaian, penanda [n] itu memang
            tidak punya paper yang disetujui di belakangnya. Isi modul tidak ditampilkan sampai
            diperbaiki.
          </p>
        </div>
      )}

      {(tier1.findings.length > 0 || criticFlags.length > 0) && (
        <div className="mt-3 space-y-3">
          {tier1.findings.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">
                Temuan Tahap 1 — deterministik ({tier1.findings.length})
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                Hanya memeriksa keterhubungan struktural ke sumber, bukan ketepatan tafsir.
              </p>
              <ul className="mt-1 space-y-2">
                {tier1.findings.map((f, i) => (
                  <li
                    key={`${f.check}-${i}`}
                    className="rounded-card border border-border p-2 text-xs"
                  >
                    <span
                      className={`mr-2 rounded px-1.5 py-0.5 font-semibold ${
                        f.severity === "fail"
                          ? "bg-red-500/15 text-red-700 dark:text-red-300"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      }`}
                    >
                      {f.severity === "fail" ? "GAGAL" : "PERINGATAN"}
                    </span>
                    <span className="text-muted">{f.reason}</span>
                    <p className="mt-1 italic">“{f.claimText}”</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {criticFlags.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">
                Ditandai kritikus AI — Tahap 2 ({criticFlags.length})
              </h4>
              <p className="text-xs text-muted leading-relaxed">
                Opini kedua, bukan putusan: tanda ini tidak pernah menahan modul dan bisa salah juga.
                Perlu dibaca manusia.
              </p>
              <ul className="mt-1 space-y-2">
                {criticFlags.map((f, i) => (
                  <li key={`critic-${i}`} className="rounded-card border border-border p-2 text-xs">
                    <span
                      className={`mr-2 rounded px-1.5 py-0.5 font-semibold ${
                        f.verdict === "contradicted"
                          ? "bg-orange-500/15 text-orange-700 dark:text-orange-300"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      }`}
                    >
                      {f.verdict === "contradicted" ? "KONTRADIKSI" : "TIDAK PASTI"}
                    </span>
                    <span className="text-muted">{f.note}</span>
                    <p className="mt-1 italic">“{f.claimText}”</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-border pt-3">
        {/* A blocked module is already withheld from the reader above; offering a
            soft "regenerate" here would be noise. Only the findings + alert show. */}
        {!blocked &&
          (flagged === 0 ? (
          // Nothing to fix: no regeneration affordance at all (Part 4 rule 2).
          <p className="text-sm text-green-700 dark:text-green-300 leading-relaxed">
            Modul ini sudah lolos Tahap 1{critic?.ran ? " dan Tahap 2" : ""} — tidak ada klaim yang
            ditandai, jadi tidak ada yang perlu diperbaiki.
            {!critic?.ran && " Tinjauan AI (Tahap 2) belum dijalankan."}
          </p>
        ) : attemptsLeft === 0 ? (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-300 leading-relaxed">
            Sudah {attemptsUsed} kali perbaikan terarah dan {flagged} temuan masih ada: belum bisa
            diperbaiki otomatis, tinjau manual.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm leading-relaxed">
              Ada {flagged} temuan. Perbaikan hanya menyasar klaim bertanda itu — dengan teks klaim,
              alasannya, dan teks sumber aslinya — bukan menulis ulang seluruh modul.
            </p>
            <button
              type="button"
              disabled={busy !== null || !online}
              onClick={runRepair}
              title={online ? undefined : "Butuh internet"}
              className="tap min-h-11 rounded-card bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              {busy === "repair" ? "Memperbaiki klaim bertanda…" : "Kembangkan lebih lagi?"}
            </button>
            <p className="text-xs text-muted">
              Sisa percobaan otomatis: {attemptsLeft} dari {MAX_REPAIR_ATTEMPTS}.
            </p>
          </div>
        ))}
        {note && (
          <p role="status" className="mt-2 text-xs text-muted">
            {note}
          </p>
        )}
      </div>
    </section>
  );
}
