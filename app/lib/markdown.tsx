import type { ReactNode } from "react";
import { slugifyHeading } from "./study";
import { parseBlocks, parseInline, type InlineRun } from "./markdownBlocks";

function Citation({ n, onCite }: { n: number; onCite?: (n: number) => void }) {
  return (
    <sup>
      {onCite ? (
        <button
          type="button"
          onClick={() => onCite(n)}
          className="ml-0.5 rounded bg-indigo-100 px-1 align-super text-[0.7em] font-semibold text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/60 dark:text-indigo-300"
          title={`Lihat sumber ${n}`}
        >
          {n}
        </button>
      ) : (
        <span className="ml-0.5 align-super text-[0.7em] font-semibold text-indigo-600 dark:text-indigo-300">
          {n}
        </span>
      )}
    </sup>
  );
}

function renderInline(
  text: string,
  keyPrefix: string,
  onCite?: (n: number) => void,
): ReactNode[] {
  return parseInline(text).map((run: InlineRun, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (run.kind) {
      case "bold":
        return (
          <strong key={key} className="font-semibold">
            {run.text}
          </strong>
        );
      case "italic":
        return <em key={key}>{run.text}</em>;
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-zinc-200/70 px-1 py-0.5 text-[0.85em] dark:bg-zinc-700/60"
          >
            {run.text}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={run.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link underline underline-offset-2 hover:no-underline"
          >
            {run.text}
          </a>
        );
      case "cite":
        return <Citation key={key} n={run.n} onCite={onCite} />;
      case "text":
      default:
        return run.text;
    }
  });
}

function MarkdownTable({
  header,
  rows,
  keyPrefix,
  onCite,
}: {
  header: string[];
  rows: string[][];
  keyPrefix: string;
  onCite?: (n: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[0.9em]">
        {header.length > 0 && (
          <thead>
            <tr>
              {header.map((cell, j) => (
                <th
                  key={j}
                  scope="col"
                  className="border border-border px-2 py-1 text-left font-semibold"
                >
                  {renderInline(cell, `${keyPrefix}-h-${j}`, onCite)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} className="border border-border px-2 py-1 align-top">
                  {renderInline(cell, `${keyPrefix}-${r}-${c}`, onCite)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Markdown({
  text,
  className = "",
  onCite,
}: {
  text: string;
  className?: string;
  onCite?: (n: number) => void;
}) {
  const blocks = parseBlocks(text);
  return (
    <div className={`space-y-3 leading-relaxed ${className}`}>
      {blocks.map((b, idx) => {
        const key = `b-${idx}`;
        if (b.type === "h1") {
          return (
            <h1 key={key} className="mt-2 text-2xl font-bold">
              {renderInline(b.text, key, onCite)}
            </h1>
          );
        }
        if (b.type === "h2") {
          return (
            <h2
              key={key}
              id={slugifyHeading(b.text)}
              className="mt-4 border-b border-zinc-200 pb-1 text-xl font-semibold dark:border-zinc-700"
            >
              {renderInline(b.text, key, onCite)}
            </h2>
          );
        }
        if (b.type === "h3") {
          return (
            <h3
              key={key}
              id={slugifyHeading(b.text)}
              className="mt-3 text-lg font-semibold text-indigo-700 dark:text-indigo-300"
            >
              {renderInline(b.text, key, onCite)}
            </h3>
          );
        }
        if (b.type === "h4") {
          return (
            <h4 key={key} className="mt-2 text-base font-semibold">
              {renderInline(b.text, key, onCite)}
            </h4>
          );
        }
        if (b.type === "hr") {
          return <hr key={key} className="border-zinc-200 dark:border-zinc-700" />;
        }
        if (b.type === "quote") {
          return (
            <blockquote
              key={key}
              className="border-l-4 border-brand-500 pl-3 italic text-zinc-600 dark:text-zinc-300"
            >
              {renderInline(b.text, key, onCite)}
            </blockquote>
          );
        }
        if (b.type === "code") {
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-card bg-zinc-100 p-3 text-[0.85em] leading-normal dark:bg-zinc-800"
            >
              <code className={b.lang ? `language-${b.lang}` : undefined}>{b.code}</code>
            </pre>
          );
        }
        if (b.type === "table") {
          return (
            <MarkdownTable
              key={key}
              header={b.header}
              rows={b.rows}
              keyPrefix={key}
              onCite={onCite}
            />
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={key} className="list-disc space-y-1 pl-6">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it, `${key}-${j}`, onCite)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={key} className="list-decimal space-y-1 pl-6">
              {b.items.map((it, j) => (
                <li key={j}>{renderInline(it, `${key}-${j}`, onCite)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={key} className="text-zinc-800 dark:text-zinc-200">
            {renderInline(b.text, key, onCite)}
          </p>
        );
      })}
    </div>
  );
}
