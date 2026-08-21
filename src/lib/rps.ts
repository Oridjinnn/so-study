// RPS (Rencana Pembelajaran Semester) reconciliation — pure, deterministic,
// no IO. Unit-tested in rps.test.ts.
//
// Why this exists (Risk Register R1, High likelihood / High impact): the student
// builds topics in a self-chosen order, then later receives the lecturer's
// official RPS/syllabus. Without a comparison they cannot tell which topics they
// studied out of sequence, so "I am prepared for week 3" may be false. This
// module computes that comparison; it never mutates anything.
//
// The diff is recomputed on every read from live Topic rows (rather than stored
// alongside the pasted order) so it cannot go stale when topics are added,
// renamed or deleted.

/** A topic as the reconciler sees it: identity, title, optional week. */
export interface RPSTopic {
  id: string;
  title: string;
  weekNumber?: number | null;
}

export type RPSRowStatus =
  /** Same position in both orders. */
  | "aligned"
  /** Present in both, but at a different position. */
  | "moved"
  /** The student created it; the official order does not list it. */
  | "not_in_official"
  /** The official order lists it; the student has no topic for it yet. */
  | "not_started";

export interface RPSDiffRow {
  title: string;
  /** null when the official order lists a topic the student has not created. */
  topicId: string | null;
  /** 1-based position in the official order; null when only the student has it. */
  officialPosition: number | null;
  /** 1-based position in the student's order; null when not yet created. */
  customPosition: number | null;
  /** customPosition - officialPosition; null unless both are known. */
  delta: number | null;
  status: RPSRowStatus;
}

/**
 * Compare titles ignoring case, punctuation, list numbering and whitespace runs,
 * so "1. Pengantar Antropologi" and "Pengantar antropologi" are the same topic.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a pasted official order into ordered topic titles.
 *
 * Accepts one topic per line and tolerates the numbering people actually paste
 * from a syllabus: "1.", "1)", "(1)", "-", "*", "•", "Minggu 3:", "Pertemuan 3 -".
 * Splits on newlines and semicolons ONLY — never commas, because commas occur
 * inside real topic titles ("Kekuasaan, Wacana, dan Tubuh") and splitting them
 * would silently shred one topic into three.
 *
 * Blank entries are dropped and repeats (after normalization) keep their first
 * occurrence, so a duplicated line cannot occupy two official positions.
 */
export function parseOfficialOrder(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/[\n;]+/)) {
    const cleaned = rawLine
      // leading list markers / numbering
      .replace(/^\s*[-*•·]+\s*/, "")
      .replace(/^\s*\(?\d+\)?\s*[.)\]:-]?\s*/, "")
      // "Minggu 3:" / "Pertemuan 3 -" / "Week 3."
      .replace(/^\s*(minggu|pertemuan|week|topik)\s*\d*\s*[.)\]:-]?\s*/i, "")
      .trim();
    if (!cleaned) continue;
    const key = normalizeTitle(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/**
 * The order the student has actually been studying in.
 *
 * `weekNumber` wins when set (it is the student's own sequencing signal);
 * topics without one follow, in the order supplied by the caller (which passes
 * them in creation order). The sort is stable, so equal keys never reshuffle
 * between reads — a diff that flickered per request would be useless.
 */
export function sortCustomOrder<T extends RPSTopic>(topics: T[]): T[] {
  return topics
    .map((t, index) => ({ t, index }))
    .sort((a, b) => {
      const aw = a.t.weekNumber ?? Number.POSITIVE_INFINITY;
      const bw = b.t.weekNumber ?? Number.POSITIVE_INFINITY;
      if (aw !== bw) return aw - bw;
      return a.index - b.index;
    })
    .map((x) => x.t);
}

/**
 * Diff the student's order against the official one.
 *
 * Output order is the official sequence first (that is the sequence the lecturer
 * will actually follow, so it is what the student needs to read down), followed
 * by any topics only the student has.
 */
export function diffTopicOrder(official: string[], custom: RPSTopic[]): RPSDiffRow[] {
  const ordered = sortCustomOrder(custom);
  const byTitle = new Map<string, { topic: RPSTopic; position: number }>();
  ordered.forEach((topic, i) => {
    const key = normalizeTitle(topic.title);
    // First occurrence wins: two topics with the same title are a data quirk,
    // not two official positions.
    if (key && !byTitle.has(key)) byTitle.set(key, { topic, position: i + 1 });
  });

  const rows: RPSDiffRow[] = [];
  const matchedTopicIds = new Set<string>();
  const seenOfficial = new Set<string>();

  official.forEach((title, i) => {
    const key = normalizeTitle(title);
    // Defensive: `parseOfficialOrder` already dedupes, but if a duplicate ever
    // reaches here it must not let one topic occupy two official positions.
    if (key && seenOfficial.has(key)) return;
    if (key) seenOfficial.add(key);
    const hit = byTitle.get(key);
    if (!hit) {
      rows.push({
        title,
        topicId: null,
        officialPosition: i + 1,
        customPosition: null,
        delta: null,
        status: "not_started",
      });
      return;
    }
    matchedTopicIds.add(hit.topic.id);
    const officialPosition = i + 1;
    const delta = hit.position - officialPosition;
    rows.push({
      title: hit.topic.title,
      topicId: hit.topic.id,
      officialPosition,
      customPosition: hit.position,
      delta,
      status: delta === 0 ? "aligned" : "moved",
    });
  });

  ordered.forEach((topic, i) => {
    if (matchedTopicIds.has(topic.id)) return;
    rows.push({
      title: topic.title,
      topicId: topic.id,
      officialPosition: null,
      customPosition: i + 1,
      delta: null,
      status: "not_in_official",
    });
  });

  return rows;
}

/** Topic ids whose position the official order confirms (status "aligned"). */
export function alignedTopicIds(rows: RPSDiffRow[]): string[] {
  return rows
    .filter((r) => r.status === "aligned" && r.topicId !== null)
    .map((r) => r.topicId as string);
}

export interface RPSSummary {
  aligned: number;
  moved: number;
  notInOfficial: number;
  notStarted: number;
}

export function summarizeDiff(rows: RPSDiffRow[]): RPSSummary {
  return {
    aligned: rows.filter((r) => r.status === "aligned").length,
    moved: rows.filter((r) => r.status === "moved").length,
    notInOfficial: rows.filter((r) => r.status === "not_in_official").length,
    notStarted: rows.filter((r) => r.status === "not_started").length,
  };
}
