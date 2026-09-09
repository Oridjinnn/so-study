"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Markdown from "../lib/markdown";
import TableOfContents from "./TableOfContents";
import PretestGate from "./PretestGate";

type Props = {
  topicId: string;
  moduleId?: string;
  contentMarkdown: string;
  pageCount?: number | null;
  pretestDone: boolean;
  onPretestDone: () => void;
  onCite: (n: number) => void;
};

// Rough A4 page budget: ~3000 readable chars per page at 11pt. Used only as a
// fallback when the server has not stored a verified page count (Part 2, step 4
// — prefer the real measured value over this client-side guess).
const CHARS_PER_PAGE = 3000;
const TARGET_PAGES = 10;

function estimatePages(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>#`-]/g, " ");
  const chars = text.trim().length;
  return Math.max(1, Math.ceil(chars / CHARS_PER_PAGE));
}

function countSections(markdown: string): number {
  const m = markdown.match(/^#{2,3}\s+/gm);
  return m ? m.length : 0;
}

/**
 * Preview cutoff: show up to and including section 3 ("Konsep kunci & definisi")
 * — roughly the first third of the module — so the in-app reader is a teaser
 * that points to the full PDF, not a hard content wall. If the module does not
 * follow the expected scaffold, fall back to the first third by characters.
 */
function truncatePreview(markdown: string): string {
  const konsepIdx = markdown.search(/^##\s+.*konsep kunci/im);
  if (konsepIdx !== -1) {
    // Find the next top-level "## " heading AFTER the Konsep kunci heading.
    const after = markdown.slice(konsepIdx + 1);
    const next = after.search(/^##\s+/m);
    if (next !== -1) {
      return markdown.slice(0, konsepIdx + 1 + next).trim();
    }
    return markdown.trim(); // nothing after Konsep kunci — show it all
  }
  const third = Math.floor(markdown.length / 3);
  return markdown.slice(0, third).trim();
}

export default function ReadStep({
  topicId,
  moduleId,
  contentMarkdown,
  pageCount,
  pretestDone,
  onPretestDone,
  onCite,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollPct, setScrollPct] = useState(0);
  const showFull = useMemo(() => pretestDone, [pretestDone]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setScrollPct(max > 0 ? el.scrollTop / max : 0);
  }, []);

  // Prefer the server-verified page count; only guess client-side when absent.
  const pages = pageCount != null ? pageCount : estimatePages(contentMarkdown);
  const sections = countSections(contentMarkdown);
  const currentPage = Math.min(pages, Math.max(1, Math.floor(scrollPct * pages) + 1));
  const meetsTarget = pageCount != null ? pageCount >= TARGET_PAGES : pages >= TARGET_PAGES;

  const previewMarkdown = useMemo(() => truncatePreview(contentMarkdown), [contentMarkdown]);
  const shownMarkdown = showFull ? contentMarkdown : previewMarkdown;
  const isPreview = !showFull && previewMarkdown.length < contentMarkdown.length;

  return (
    <div id="panel-read" role="tabpanel" aria-labelledby="tab-read" className="space-y-4">
      {!pretestDone && (
        <PretestGate topicId={topicId} onDone={onPretestDone} />
      )}

      <div className="overflow-hidden rounded-card border border-border bg-card">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-4 py-2 text-sm backdrop-blur print:hidden">
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                meetsTarget
                  ? "bg-green-500/15 text-green-700 dark:text-green-300"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              }`}
              title={
                pageCount != null
                  ? "Jumlah halaman hasil pengukuran nyata pasca-generasi"
                  : "Perkiraan halaman berdasarkan panjang teks (≈3000 karakter/halaman)"
              }
            >
              Halaman {currentPage} / {pages} ≈
            </span>
            <span className="text-muted">{sections} bagian</span>
          </div>
          <span
            className={`text-xs font-medium ${
              meetsTarget ? "text-green-700 dark:text-green-300" : "text-amber-700 dark:text-amber-300"
            }`}
          >
            {meetsTarget ? "Target ≥ 10 halaman terpenuhi" : "Belum mencapai 10 halaman"}
          </span>
        </div>
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="reader-scroll overflow-y-auto p-5 sm:p-7"
        >
          <article className="reader-prose leading-relaxed">
            <TableOfContents markdown={shownMarkdown} />
            <Markdown text={shownMarkdown} onCite={onCite} />

            {isPreview && (
              <div className="mt-6 rounded-card border border-border bg-card p-4 text-sm shadow-sm print:hidden">
                <p className="mb-3 text-foreground">
                  Ini pratinjau modul. Baca versi lengkap (≈10 halaman) dalam format PDF yang
                  lebih nyaman dibaca.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  {moduleId && (
                    <>
                      <a
                        href={`/api/modules/${moduleId}/export?format=pdf`}
                        className="rounded-lg bg-brand-500 px-3 py-1.5 font-medium text-white transition-colors hover:bg-brand-600"
                      >
                        Unduh modul lengkap (PDF)
                      </a>
                      <a
                        href={`/api/modules/${moduleId}/export?format=pdf-worksheet`}
                        className="rounded-lg border border-brand-500 px-3 py-1.5 font-medium text-brand-700 transition-colors hover:bg-brand-500/10 dark:text-brand-300"
                      >
                        Unduh lembar kerja (PDF)
                      </a>
                    </>
                  )}
                </div>
              </div>
            )}
          </article>
        </div>

        {pageCount != null && pageCount < TARGET_PAGES && (
          <div className="border-t border-border bg-amber-50 px-4 py-2 text-xs text-amber-800 print:hidden dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
            Modul ini agak lebih ringkas dari target 10 halaman.
          </div>
        )}

        <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-800/60 print:hidden">
          <div
            className="h-full bg-brand-500 transition-[width] duration-150"
            style={{ width: `${Math.round(scrollPct * 100)}%` }}
            role="progressbar"
            aria-label="Progres membaca"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(scrollPct * 100)}
          />
        </div>
      </div>
    </div>
  );
}
