import { describe, expect, it } from "vitest";
import { mapWithConcurrencyLimit } from "./concurrency";

describe("mapWithConcurrencyLimit", () => {
  it("preserves input order in the results", async () => {
    const out = await mapWithConcurrencyLimit([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("never runs more than `limit` tasks concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrencyLimit(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
    );
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(maxActive).toBeGreaterThan(1); // proved it actually parallelized
  });

  it("returns [] for an empty input", async () => {
    expect(await mapWithConcurrencyLimit([], 4, async (n: number) => n)).toEqual([]);
  });

  it("propagates the first rejection without hanging", async () => {
    await expect(
      mapWithConcurrencyLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
