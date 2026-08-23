// Tiny, dependency-free concurrency cap. Used to parallelize independent
// (non-dependent) async work — e.g. the per-paper DB writes in synthesis — so
// wall-clock time drops on multi-paper topics without firing an unbounded
// number of concurrent calls (which would hammer the DB connection pool or trip
// a provider rate limit). Each item still runs to completion; results preserve
// input order.

export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];
  const cap = Math.max(1, Math.min(limit, n));

  const results = new Array<R>(n);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < n) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: cap }, () => worker()));
  return results;
}
