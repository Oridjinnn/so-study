import { describe, expect, it } from "vitest";
import { review, outcomeToGrade, isDue, previewIntervals } from "./scheduler";

// P0: the scheduler must now be real spaced repetition -- intervals expand
// across correct recalls and reset on a lapse, instead of the old flat
// confidence->interval lookup that never grew.

describe("outcomeToGrade", () => {
  it("maps a correct answer to q >= 3 regardless of confidence", () => {
    expect(outcomeToGrade(true, 1)).toBeGreaterThanOrEqual(3);
    expect(outcomeToGrade(true, 5)).toBe(5);
    expect(outcomeToGrade(true, null)).toBe(3);
  });

  it("maps an incorrect answer to q < 3 (a lapse)", () => {
    expect(outcomeToGrade(false, 5)).toBe(2); // confident misconception = worst
    expect(outcomeToGrade(false, 1)).toBe(0);
    expect(outcomeToGrade(false, null)).toBeLessThan(3);
  });
});

describe("review (FSRS-derived expansion)", () => {
  it("first correct recall schedules 1 day out", () => {
    const { state, nextReview } = review(null, 4);
    expect(state.repetitions).toBe(1);
    expect(state.intervalDays).toBe(1);
    expect(state.stability).toBe(1);
    expect(nextReview.getTime()).toBeGreaterThan(Date.now());
  });

  it("second correct recall jumps to ~4 days", () => {
    const r1 = review(null, 4);
    const r2 = review(r1.state, 4);
    expect(r2.state.repetitions).toBe(2);
    expect(r2.state.intervalDays).toBe(4);
    expect(r2.state.stability).toBe(4);
  });

  it("intervals expand across repeated correct recalls", () => {
    let prev = review(null, 4).state; // 1 day
    prev = review(prev, 4).state; // 4 days
    const third = review(prev, 4);
    expect(third.state.intervalDays).toBeGreaterThan(4);
    const fourth = review(third.state, 4);
    expect(fourth.state.intervalDays).toBeGreaterThan(third.state.intervalDays);
  });

  it("higher confidence correct answers expand faster (higher EF + interval)", () => {
    const hi = review(review(review(null, 5).state, 5).state, 5).state;
    const lo = review(review(review(null, 3).state, 3).state, 3).state;
    expect(hi.easeFactor).toBeGreaterThan(lo.easeFactor);
    expect(hi.intervalDays).toBeGreaterThan(lo.intervalDays);
  });

  it("an incorrect answer resets the streak and relearns soon", () => {
    const built = review(review(review(null, 4).state, 4).state, 4).state; // reps=3
    expect(built.repetitions).toBe(3);
    const lapsed = review(built, 1);
    expect(lapsed.lapsed).toBe(true);
    expect(lapsed.state.repetitions).toBe(0);
    expect(lapsed.state.intervalDays).toBeGreaterThanOrEqual(1);
  });

  it("ease factor never drops below the 1.3 floor", () => {
    let prev = review(null, 3).state;
    for (let i = 0; i < 5; i++) prev = review(prev, 0).state; // repeated lapses
    let p2 = review(null, 3).state;
    for (let i = 0; i < 10; i++) p2 = review(p2, 3).state;
    expect(p2.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it("uses the supplied 'now' as the anchor for nextReview", () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    const { nextReview } = review(null, 4, now);
    expect(nextReview.toISOString()).toBe("2030-01-02T00:00:00.000Z");
  });

  it("(a) stability increases on repeated correct recalls", () => {
    let prev = review(null, 4).state;
    expect(prev.stability).toBe(1);
    prev = review(prev, 4).state;
    expect(prev.stability).toBe(4);
    const third = review(prev, 4).state;
    expect(third.stability).toBeGreaterThan(prev.stability);
    const fourth = review(third, 4).state;
    expect(fourth.stability).toBeGreaterThan(third.stability);
  });

  it("(b) a lapse after a streak drops stability and resets repetitions", () => {
    let prev = review(null, 4).state;
    prev = review(prev, 4).state;
    const before = prev.stability;
    const lapsed = review(prev, 1);
    expect(lapsed.lapsed).toBe(true);
    expect(lapsed.state.repetitions).toBe(0);
    expect(lapsed.state.stability).toBeLessThan(before);
  });

  it("(c) difficulty shifts with grade", () => {
    // A perfect recall makes the card easier (lower difficulty).
    const perfect = review(null, 5).state;
    expect(perfect.difficulty).toBeLessThan(5);
    // A marginal correct recall leaves difficulty roughly unchanged.
    const marginal = review(null, 3).state;
    expect(marginal.difficulty).toBeCloseTo(5, 5);
  });

  it("(d) FSRS intervals expand across successive reviews", () => {
    const chain = [review(null, 4).state];
    for (let i = 0; i < 3; i++) chain.push(review(chain[chain.length - 1], 4).state);
    const intervals = chain.map((s) => s.intervalDays);
    // strictly increasing -> truly spaced, not a flat lookup
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
    // after three reviews the interval has grown well beyond a single base
    expect(intervals[3]).toBeGreaterThan(6);
  });
});


describe("desired retention", () => {
  it("defaults to 0.90 and keeps the uncalibrated interval", () => {
    const { state } = review(null, 4); // default retention
    expect(state.intervalDays).toBe(1);
  });

  it("longer desired retention yields a longer interval", () => {
    const built = review(review(review(null, 4).state, 4).state, 4).state; // mature
    const low = review(built, 4, new Date(), 0.8).state.intervalDays;
    const high = review(built, 4, new Date(), 0.97).state.intervalDays;
    expect(high).toBeGreaterThan(low);
  });

  it("clamps desired retention into [0.70, 0.97]", () => {
    const built = review(review(review(null, 4).state, 4).state, 4).state;
    const clampedHigh = review(built, 4, new Date(), 0.999).state.intervalDays;
    const explicitMax = review(built, 4, new Date(), 0.97).state.intervalDays;
    expect(clampedHigh).toBe(explicitMax);
  });
});

describe("elapsed-time aware growth", () => {
  it("uses actual elapsed days so longer gaps grow the interval more", () => {
    const built = review(review(review(null, 4).state, 4).state, 4).state; // mature
    const shortGap = review(built, 4, new Date(), 0.9, 2).state.intervalDays;
    const longGap = review(built, 4, new Date(), 0.9, 20).state.intervalDays;
    expect(longGap).toBeGreaterThan(shortGap);
  });

  it("clamps negative elapsed to 0 (no time travel)", () => {
    const built = review(review(review(null, 4).state, 4).state, 4).state;
    const neg = review(built, 4, new Date(), 0.9, -5).state.intervalDays;
    const zero = review(built, 4, new Date(), 0.9, 0).state.intervalDays;
    expect(neg).toBe(zero);
  });

  it("omitting elapsed preserves the original growth (backward compatible)", () => {
    const built = review(review(review(null, 4).state, 4).state, 4).state;
    // Omitting elapsed must equal passing elapsed = 0 (no time-aware boost),
    // i.e. behavior is identical to the original scheduler.
    const withElapsed = review(built, 4, new Date(), 0.9).state.intervalDays;
    const baseline = review(built, 4, new Date(), 0.9, 0).state.intervalDays;
    expect(withElapsed).toBe(baseline);
  });
});

describe("previewIntervals", () => {
  it("orders again < hard < good < easy for a fresh card", () => {
    const p = previewIntervals(null);
    expect(p.again).toBeLessThan(p.hard);
    expect(p.hard).toBeLessThan(p.good);
    expect(p.good).toBeLessThan(p.easy);
  });

  it("orders again < hard < good < easy for a mature card", () => {
    const mature = review(review(review(null, 4).state, 4).state, 4).state;
    const p = previewIntervals(mature);
    expect(p.again).toBeLessThan(p.hard);
    expect(p.hard).toBeLessThan(p.good);
    expect(p.good).toBeLessThan(p.easy);
  });

  it("higher desired retention yields longer previewed intervals", () => {
    const mature = review(review(review(null, 4).state, 4).state, 4).state;
    const low = previewIntervals(mature, 0.8);
    const high = previewIntervals(mature, 0.97);
    expect(high.good).toBeGreaterThan(low.good);
    expect(high.good).toBeGreaterThan(high.again);
  });
});

describe("isDue", () => {
  it("is due when scheduledNextAt is null", () => {
    expect(isDue({ scheduledNextAt: null, answeredAt: new Date().toISOString() })).toBe(true);
  });

  it("is due when scheduledNextAt is in the past", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isDue({ scheduledNextAt: past, answeredAt: past })).toBe(true);
  });

  it("is due when scheduledNextAt equals now", () => {
    const now = new Date().toISOString();
    expect(isDue({ scheduledNextAt: now, answeredAt: now })).toBe(true);
  });

  it("is not due when scheduledNextAt is in the future", () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(isDue({ scheduledNextAt: future, answeredAt: new Date().toISOString() })).toBe(false);
  });
});
