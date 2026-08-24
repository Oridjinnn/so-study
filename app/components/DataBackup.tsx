"use client";

import { useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import Icon from "./Icon";
import { PRIMARY_CLASS, SECONDARY_CLASS } from "./ui";

const LAST_EXPORT_KEY = "so-study:lastBackupExport";

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

function todayStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function DataBackup() {
  const [lastExport, setLastExport] = useState<string | null>(() => {
    try {
      return typeof window !== "undefined" ? localStorage.getItem(LAST_EXPORT_KEY) : null;
    } catch {
      // Storage unavailable: the field simply stays empty.
      return null;
    }
  });
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setStatus({ kind: "busy" });
    try {
      const res = await apiFetch("/api/backup", { method: "GET" });
      if (!res.ok) throw new Error(`GET /api/backup → ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `so-study-backup-${todayStamp()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const stamp = new Date().toISOString();
      try {
        localStorage.setItem(LAST_EXPORT_KEY, stamp);
        setLastExport(stamp);
      } catch {
        // Non-fatal: the file was still downloaded.
      }
      setStatus({ kind: "ok", message: "Cadangan berhasil diunduh." });
    } catch {
      setStatus({ kind: "error", message: "Gagal mengekspor data." });
    }
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setStatus({ kind: "idle" });
  }

  async function handleImport() {
    if (!file) return;
    setStatus({ kind: "busy" });
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await apiFetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, confirm: "overwrite" }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Impor gagal (${res.status}).`);
      }
      setStatus({ kind: "ok", message: "Data berhasil diimpor." });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impor gagal.";
      setStatus({ kind: "error", message });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleExport}
          disabled={status.kind === "busy"}
          className={`${SECONDARY_CLASS} flex-1`}
        >
          <Icon name="download" /> Ekspor data
        </button>
        <label className={`${SECONDARY_CLASS} flex-1`}>
          <Icon name="save" /> Pilih berkas
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onFileChosen}
            className="sr-only"
          />
        </label>
      </div>

      {file && (
        <button
          type="button"
          onClick={handleImport}
          disabled={status.kind === "busy"}
          className={PRIMARY_CLASS}
        >
          <Icon name="backup" /> Impor dan timpa data
        </button>
      )}

      <p className="text-[11px] leading-snug text-muted" role="alert">
        Peringatan: impor akan menimpa data lokal dengan isi berkas. Buat ekspor
        terlebih dahulu jika perlu menyimpan data saat ini.
      </p>

      {lastExport && (
        <p className="text-[11px] text-muted">
          Ekspor terakhir: {new Date(lastExport).toLocaleString("id-ID")}
        </p>
      )}

      {status.kind === "ok" && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{status.message}</p>
      )}
      {status.kind === "error" && (
        <p className="text-[11px] text-red-600 dark:text-red-400">{status.message}</p>
      )}
    </div>
  );
}
