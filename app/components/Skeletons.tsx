export function MCQSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
          <div className="mb-3 h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="space-y-2">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="h-4 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SynthesisSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
          style={{ width: `${90 - (i % 3) * 15}%` }}
        />
      ))}
    </div>
  );
}
