export function MCQSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
        >
          <div className="mb-3 h-4 w-3/4 skeleton-shimmer rounded" />
          <div className="space-y-2">
            {[0, 1, 2, 3].map((j) => (
              <div
                key={j}
                className="h-4 w-full skeleton-shimmer rounded"
              />
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
          className="h-4 skeleton-shimmer rounded"
          style={{ width: `${90 - (i % 3) * 15}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Placeholder shaped like the paper-review list (title + meta line + abstract
 * lines per candidate), shown while `/api/retrieve` is in flight. Retrieval
 * takes ~10s; without this the UI looked frozen, which reads as broken rather
 * than slow — the point is to show the SHAPE of what is coming, immediately.
 */
export function PaperListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
          <div className="mb-2 h-4 w-4/5 skeleton-shimmer rounded" />
          <div className="mb-3 h-3 w-2/5 skeleton-shimmer rounded" />
          <div className="space-y-1.5">
            <div className="h-3 w-full skeleton-shimmer rounded" />
            <div className="h-3 w-11/12 skeleton-shimmer rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
