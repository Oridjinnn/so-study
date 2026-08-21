// Stateful spaced-repetition scheduler (FSRS-inspired SM-2 hybrid).
//
// This replaces the earlier flat confidence -> interval lookup (which never
// remembered a card's history and so never grew the interval) and the pure
// SM-2 variant with an FSRS-derived memory model: every card carries a
// `stability` (memory strength, in days) and a `difficulty` (item difficulty
// on a 1..10 scale). Stability is what actually drives the next interval.
//
// Evidence base:
//  - FSRS (Free Spaced Repetition Scheduler):
//    https://github.com/open-spaced-repetition/fsrs
//    Stability S grows on successful recalls; on a lapse it decays sharply and
//    the repetition streak resets (relearning).
//  - Dunlosky et al. 2013, Table 4: distributed / spaced practice = High
//    utility (https://doi.org/10.1177/1529100612453266).
//  - Cepeda et al. 2006/2008: the spacing effect -- longer gaps aid retention.
//  - SuperMemo SM-2: https://super-memory.com/english/ol/sm2.htm
//    (q >= 3 == correct recall; we keep intervalDays/repetitions/easeFactor
//    for backward display).

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;

// Desired-retention target. FSRS deck-options default is 0.90 (see
// https://docs.ankiweb.net/deck-options.html#fsrs): the probability the card
// is still remembered at the moment it is due. Higher retention => the
// scheduler spaces reviews further apart. Clamped to a sane band so the
// log-based interval scaling below stays defined and never explodes.
const DESIRED_RETENTION_BASE = 0.9;
const MIN_RETENTION = 0.7;
const MAX_RETENTION = 0.97;

// FSRS-inspired stability bases (days). The first successful recall lands ~1
// day out; the second ~4 days; after that stability compounds (see `review`).
const INITIAL_STABILITY = 1;
const SECOND_STABILITY = 4;
const LAPSE_DECAY = 0.4; // stability multiplier on a lapse (0.3..0.5 range)

export interface SchedulerState {
  intervalDays: number; // I(n): days until the next review (computed from S)
  repetitions: number; // n: consecutive successful recalls
  easeFactor: number; // EF: SM-2 multiplier kept for backward display
  stability: number; // S: FSRS memory stability (days to ~90% retention)
  difficulty: number; // D: FSRS item difficulty (1..10, lower == easier)
}

export const INITIAL_STATE: SchedulerState = {
  intervalDays: 0,
  repetitions: 0,
  easeFactor: DEFAULT_EASE,
  stability: INITIAL_STABILITY,
  difficulty: 5,
};

// SM-2 quality grade, 0 (total blackout) .. 5 (perfect, instant).
export type Grade = 0 | 1 | 2 | 3 | 4 | 5;

// Map a practice outcome to an SM-2 quality grade.
//  - A correct answer is always q >= 3 (the SM-2 "pass" threshold), and the
//    self-rated confidence (1..5) nudges it: a high-confidence correct answer
//    expands faster, a low-confidence correct answer stays conservative.
//  - An incorrect answer is q < 3, which resets the repetition count. A
//    high-confidence wrong answer (a confident misconception) is the worst
//    case (q = 2) and should trigger targeted feedback.
export function outcomeToGrade(isCorrect: boolean | null, confidence: number | null): Grade {
  const c = confidence == null ? 3 : Math.min(5, Math.max(1, Math.round(confidence)));
  if (isCorrect === false) {
    return Math.max(0, c - 3) as Grade; // c=5 -> 2, c=1 -> 0
  }
  return Math.min(5, Math.max(3, c)) as Grade; // correct -> 3..5
}

export interface ReviewResult {
  state: SchedulerState;
  nextReview: Date;
  lapsed: boolean; // true when this review broke a correct streak
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Interval scaling for a desired retention. Stability S is calibrated to the
// base retention (0.90): the next interval that yields retention R is
//   I(R) = S * ln(1 - R) / ln(1 - R_base)
// so higher R -> longer interval (monotonic), and R = R_base reproduces the
// uncalibrated S. R is clamped to [0.70, 0.97] so ln stays defined.
function retentionFactor(desiredRetention: number): number {
  const r = clamp(desiredRetention, MIN_RETENTION, MAX_RETENTION);
  const base = 1 - DESIRED_RETENTION_BASE;
  const target = 1 - r;
  return Math.log(target) / Math.log(base);
}

// Update a card's spaced-repetition state after a single review.
//
// Correct recall (grade >= 3) raises stability (FSRS growth rule) and nudges
// difficulty: high grades make the card easier (lower D), low grades harder
// (higher D). A lapse (grade < 3 after a streak) decays stability sharply,
// resets repetitions to 0, and slightly raises difficulty (relearning).
//
// Optional knobs (both backward-compatible via defaults):
//  - `desiredRetention`: target recall probability; scales the next interval.
//  - `elapsedDays`: actual days since the last review. When supplied, the
//    stability growth is made time-aware (longer real gaps strengthen memory
//    more, per the spacing effect). Omit it to keep the original behavior.
export function review(
  prev: SchedulerState | null,
  grade: Grade,
  now: Date = new Date(),
  desiredRetention: number = DESIRED_RETENTION_BASE,
  elapsedDays?: number,
): ReviewResult {
  const p = prev ?? INITIAL_STATE;
  const lapsed = grade < 3 && p.repetitions > 0;

  let stability = p.stability;
  let difficulty = p.difficulty;
  let repetitions = p.repetitions;
  let easeFactor = p.easeFactor;

  if (grade < 3) {
    // Lapse: memory decays sharply and the streak resets (relearning).
    // Difficulty is kept but nudged slightly harder.
    stability = stability * LAPSE_DECAY;
    repetitions = 0;
    difficulty = difficulty + 0.5;
  } else {
    repetitions = p.repetitions + 1;

    // FSRS-inspired stability growth.
    if (p.repetitions === 0) {
      stability = INITIAL_STABILITY; // first successful recall ~1 day
    } else if (p.repetitions === 1) {
      stability = SECOND_STABILITY; // second successful recall ~4 days
    } else {
      // Growth factor grows with ease and with the repetition count, so
      // intervals expand across successive reviews (spacing effect).
      const growth = 1 + (easeFactor - 1) * (1 + 0.1 * (repetitions - 2));
      stability = stability * growth;

      // Time-aware growth: a longer actual gap since the last review
      // strengthens memory more (Cepeda 2008 spacing effect). Only applied
      // when the caller supplies real elapsed days; otherwise the prior
      // scheduled interval is assumed and behavior is unchanged.
      if (elapsedDays != null) {
        const scheduled = Math.max(1, p.intervalDays);
        const elapsed = Math.max(0, elapsedDays);
        const timeFactor = 1 + 0.1 * (elapsed / scheduled);
        stability = stability * timeFactor;
      }
    }

    // Difficulty shifts with the grade: perfect recall -> easier (lower D),
    // marginal recall -> harder (higher D). Dunlosky: retrieval difficulty
    // tunes memory strength.
    difficulty = difficulty + (3 - grade) * 0.2;

    // SM-2 ease update retained for backward display.
    easeFactor = p.easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
    if (easeFactor < MIN_EASE) easeFactor = MIN_EASE;
  }

  difficulty = clamp(difficulty, 1, 10);
  stability = Math.max(0.1, stability);

  // Desired-retention scaling: higher retention => longer interval.
  const rf = retentionFactor(desiredRetention);
  const intervalDays = Math.max(1, Math.round(stability * rf));

  return {
    state: { intervalDays, repetitions, easeFactor, stability, difficulty },
    nextReview: addDays(now, intervalDays),
    lapsed,
  };
}


function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

export interface DueAttempt {
  scheduledNextAt: string | null;
  answeredAt: string;
}

export function isDue(attempt: DueAttempt): boolean {
  if (attempt.scheduledNextAt == null) return true;
  const next = new Date(attempt.scheduledNextAt);
  if (Number.isNaN(next.getTime())) return true;
  return next.getTime() <= Date.now();
}

// Preview of the next-review intervals (in days) for the four grading buttons
// (Again / Hard / Good / Easy) another agent will render. Pure and
// deterministic: Again relearns same-day, Hard < Good < Easy, and every value
// scales with the desired retention (higher retention => longer intervals).
// `attempt` is the current card state (null == a brand-new card).
export interface IntervalPreview {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export function previewIntervals(
  attempt: SchedulerState | null,
  desiredRetention: number = DESIRED_RETENTION_BASE,
): IntervalPreview {
  const p = attempt ?? INITIAL_STATE;
  const rf = retentionFactor(desiredRetention);

  // Anchor on the currently scheduled interval so a mature card previews
  // longer horizons than a fresh one.
  const gap = Math.max(1, p.intervalDays);
  const again = 1; // same-day / very short relearn
  const hard = Math.max(again + 1, Math.round(gap * 0.6 * rf));
  const good = Math.max(hard + 1, Math.round(gap * 1.0 * rf));
  const easy = Math.max(good + 1, Math.round(gap * 1.5 * rf));

  return { again, hard, good, easy };
}
