"use client";

import { slugifyHeading } from "@/app/lib/study";

type Heading = { level: 2 | 3; text: string };

function parseHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("## ")) {
      headings.push({ level: 2, text: line.slice(3).trim() });
    } else if (line.startsWith("### ")) {
      headings.push({ level: 3, text: line.slice(4).trim() });
    }
  }
  return headings;
}

export default function TableOfContents({ markdown }: { markdown: string }) {
  const headings = parseHeadings(markdown);
  if (headings.length === 0) return null;

  return (
    <nav
      role="navigation"
      aria-label="Daftar isi"
      className="rounded-card border border-border bg-card p-3 text-sm shadow-sm"
    >
      <p className="mb-2 font-semibold text-muted">Daftar isi</p>
      <ul className="space-y-1">
        {headings.map((h, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() =>
                document.getElementById(slugifyHeading(h.text))?.scrollIntoView({
                  behavior: "smooth",
                })
              }
              className={`block w-full truncate rounded-lg px-2 py-1 text-left transition-colors hover:bg-brand-500/10 hover:text-brand-700 dark:hover:bg-brand-500/20 dark:hover:text-brand-300 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
                h.level === 3 ? "pl-5 text-muted" : "font-medium text-foreground"
              }`}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
