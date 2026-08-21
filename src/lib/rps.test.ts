import { describe, expect, it } from "vitest";
import {
  alignedTopicIds,
  diffTopicOrder,
  normalizeTitle,
  parseOfficialOrder,
  sortCustomOrder,
  summarizeDiff,
} from "./rps";

describe("normalizeTitle", () => {
  it("ignores case, punctuation and whitespace runs", () => {
    expect(normalizeTitle("Pengantar   Antropologi!")).toBe("pengantar antropologi");
    expect(normalizeTitle("PENGANTAR, ANTROPOLOGI")).toBe(normalizeTitle("pengantar antropologi"));
  });
});

describe("parseOfficialOrder", () => {
  it("splits on newlines and strips the numbering people actually paste", () => {
    const text = `1. Pengantar Antropologi
2) Evolusi Kebudayaan
(3) Strukturalisme
- Interpretivisme
• Poskolonialisme
Minggu 6: Antropologi Ekologi`;
    expect(parseOfficialOrder(text)).toEqual([
      "Pengantar Antropologi",
      "Evolusi Kebudayaan",
      "Strukturalisme",
      "Interpretivisme",
      "Poskolonialisme",
      "Antropologi Ekologi",
    ]);
  });

  it("never splits on commas, because topic titles contain them", () => {
    // Splitting this on commas would shred one topic into three.
    expect(parseOfficialOrder("Kekuasaan, Wacana, dan Tubuh")).toEqual([
      "Kekuasaan, Wacana, dan Tubuh",
    ]);
  });

  it("drops blank lines and collapses repeats to their first occurrence", () => {
    const parsed = parseOfficialOrder("Teori A\n\n  \nteori a\nTeori B\n");
    expect(parsed).toEqual(["Teori A", "Teori B"]);
  });

  it("returns an empty list for content with no readable titles", () => {
    expect(parseOfficialOrder("   \n\n  ")).toEqual([]);
    expect(parseOfficialOrder("1.\n2.\n3.")).toEqual([]);
  });
});

describe("sortCustomOrder", () => {
  it("orders by weekNumber, keeping unnumbered topics last in supplied order", () => {
    const sorted = sortCustomOrder([
      { id: "c", title: "C" },
      { id: "b", title: "B", weekNumber: 2 },
      { id: "d", title: "D" },
      { id: "a", title: "A", weekNumber: 1 },
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("is stable, so a diff cannot flicker between identical reads", () => {
    const input = [
      { id: "x", title: "X" },
      { id: "y", title: "Y" },
      { id: "z", title: "Z" },
    ];
    expect(sortCustomOrder(input).map((t) => t.id)).toEqual(
      sortCustomOrder(input).map((t) => t.id),
    );
  });
});

describe("diffTopicOrder", () => {
  it("marks same-position topics aligned and different-position topics moved", () => {
    const rows = diffTopicOrder(
      ["Teori A", "Teori B"],
      [
        { id: "t1", title: "Teori A", weekNumber: 1 },
        { id: "t2", title: "Teori B", weekNumber: 2 },
      ],
    );
    expect(rows.map((r) => r.status)).toEqual(["aligned", "aligned"]);
    expect(rows.every((r) => r.delta === 0)).toBe(true);
  });

  it("reports the direction and size of a mismatch", () => {
    // Official order is A,B,C; the student studied C first.
    const rows = diffTopicOrder(
      ["Teori A", "Teori B", "Teori C"],
      [
        { id: "t3", title: "Teori C", weekNumber: 1 },
        { id: "t1", title: "Teori A", weekNumber: 2 },
        { id: "t2", title: "Teori B", weekNumber: 3 },
      ],
    );
    const byTitle = new Map(rows.map((r) => [r.title, r]));
    // A is official #1 but studied 2nd -> one position later than the lecturer.
    expect(byTitle.get("Teori A")).toMatchObject({ officialPosition: 1, customPosition: 2, delta: 1, status: "moved" });
    // C is official #3 but studied 1st -> two positions early.
    expect(byTitle.get("Teori C")).toMatchObject({ officialPosition: 3, customPosition: 1, delta: -2, status: "moved" });
  });

  it("flags official topics the student has not created yet", () => {
    const rows = diffTopicOrder(["Teori A", "Teori B"], [{ id: "t1", title: "Teori A" }]);
    expect(rows[1]).toMatchObject({
      title: "Teori B",
      topicId: null,
      officialPosition: 2,
      customPosition: null,
      status: "not_started",
    });
  });

  it("flags student topics absent from the official order, listed after it", () => {
    const rows = diffTopicOrder(["Teori A"], [
      { id: "t1", title: "Teori A" },
      { id: "t9", title: "Topik Bonus" },
    ]);
    expect(rows.map((r) => r.status)).toEqual(["aligned", "not_in_official"]);
    expect(rows[1]).toMatchObject({ topicId: "t9", officialPosition: null, customPosition: 2 });
  });

  it("matches titles despite case and punctuation differences", () => {
    // `diffTopicOrder` receives the already-parsed official order, so list
    // numbering is `parseOfficialOrder`'s job (asserted above) and matching only
    // has to survive case/punctuation. `normalizeTitle` deliberately keeps
    // digits, so "Teori 2" and "Teori 3" stay distinct topics.
    const rows = diffTopicOrder(["Pengantar Antropologi!"], [
      { id: "t1", title: "pengantar antropologi" },
    ]);
    expect(rows[0].status).toBe("aligned");
    expect(rows[0].topicId).toBe("t1");
  });

  it("keeps numerically-distinct titles apart", () => {
    const rows = diffTopicOrder(["Teori 2", "Teori 3"], [
      { id: "t2", title: "Teori 2", weekNumber: 1 },
      { id: "t3", title: "Teori 3", weekNumber: 2 },
    ]);
    expect(rows.map((r) => r.topicId)).toEqual(["t2", "t3"]);
  });

  it("matches an end-to-end pasted order after parsing", () => {
    const official = parseOfficialOrder("1. Pengantar Antropologi\n2. Evolusi Kebudayaan");
    const rows = diffTopicOrder(official, [
      { id: "t1", title: "Pengantar Antropologi", weekNumber: 1 },
      { id: "t2", title: "Evolusi Kebudayaan", weekNumber: 2 },
    ]);
    expect(rows.map((r) => r.status)).toEqual(["aligned", "aligned"]);
  });

  it("preserves the stored topic title (not the pasted spelling) for matches", () => {
    const rows = diffTopicOrder(["PENGANTAR ANTROPOLOGI"], [
      { id: "t1", title: "Pengantar Antropologi" },
    ]);
    expect(rows[0].title).toBe("Pengantar Antropologi");
  });

  it("returns only student topics when no official order exists yet", () => {
    const rows = diffTopicOrder([], [{ id: "t1", title: "Teori A" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("not_in_official");
  });

  it("never assigns one topic to two official positions", () => {
    const rows = diffTopicOrder(["Teori A", "Teori A"], [{ id: "t1", title: "Teori A" }]);
    // parseOfficialOrder already collapses the duplicate; the differ holds the
    // same invariant defensively so a duplicate can never double-count a topic.
    expect(rows.filter((r) => r.topicId === "t1")).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });
});

describe("alignedTopicIds / summarizeDiff", () => {
  it("returns only the ids whose position the official order confirms", () => {
    const rows = diffTopicOrder(
      ["Teori A", "Teori B", "Teori C"],
      [
        { id: "t1", title: "Teori A", weekNumber: 1 },
        { id: "t3", title: "Teori C", weekNumber: 2 },
        { id: "extra", title: "Topik Lain", weekNumber: 3 },
      ],
    );
    // Only A sits where the lecturer puts it.
    expect(alignedTopicIds(rows)).toEqual(["t1"]);
    expect(summarizeDiff(rows)).toEqual({
      aligned: 1,
      moved: 1,
      notInOfficial: 1,
      notStarted: 1,
    });
  });
});
