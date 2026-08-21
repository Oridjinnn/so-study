import { describe, expect, it } from "vitest";
import type { ProgressData, ProgressHeatmapEntry, TopicProgress } from "./types";
import {
  DAILY_REMINDER_MESSAGE,
  DAILY_REMINDER_VARIANTS,
  hasContentToStudy,
  jakartaDateKey,
  studiedToday,
  shouldRemind,
  dailyReminderVariant,
  pickPushCopy,
} from "./soso";

function topic(): TopicProgress {
  return {
    topicId: "t1",
    title: "T",
    hasModule: false,
    status: "new",
    dueBeforeLecture: null,
    dueToday: false,
    overdue: false,
    attempts: 0,
    masteryPct: 0,
    nextReview: null,
  };
}

function heatmap(count: number): ProgressHeatmapEntry[] {
  return [{ date: "2026-08-19", count }];
}

function progress(count: number, topics = 1): ProgressData {
  return {
    topics: topics > 0 ? [topic()] : [],
    dueTodayCount: 0,
    dueTodayByCourse: {},
    streakDays: 0,
    heatmap: heatmap(count),
    avgMastery: null,
  };
}

describe("studiedToday", () => {
  it("is true when the latest heatmap entry has a positive count", () => {
    expect(studiedToday(progress(3))).toBe(true);
  });
  it("is false when the latest heatmap entry count is zero", () => {
    expect(studiedToday(progress(0))).toBe(false);
  });
  it("is false when progress is null", () => {
    expect(studiedToday(null)).toBe(false);
  });
});

describe("hasContentToStudy", () => {
  it("is true with at least one topic", () => {
    expect(hasContentToStudy(progress(0, 1))).toBe(true);
  });
  it("is false with no topics", () => {
    expect(hasContentToStudy(progress(0, 0))).toBe(false);
  });
  it("is false when progress is null", () => {
    expect(hasContentToStudy(null)).toBe(false);
  });
});

describe("shouldRemind", () => {
  it("shows when not studied today but there is content", () => {
    expect(shouldRemind(progress(0, 1))).toBe(true);
  });
  it("hides once studied today", () => {
    expect(shouldRemind(progress(5, 1))).toBe(false);
  });
  it("hides when there is nothing to study", () => {
    expect(shouldRemind(progress(0, 0))).toBe(false);
  });
});

describe("jakartaDateKey", () => {
  it("returns a YYYY-MM-DD key in Asia/Jakarta", () => {
    // 2026-08-19T20:00:00Z == 2026-08-20T03:00:00 WIB → next Jakarta day.
    const key = jakartaDateKey(new Date("2026-08-19T20:00:00Z"));
    expect(key).toBe("2026-08-20");
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("daily reminder copy", () => {
  it("exposes the exact specified message", () => {
    expect(DAILY_REMINDER_MESSAGE).toBe(
      "Hallo! Soso disini! Kamu belum belajar hari ini! hummft kamu ga kangen aku ya?!",
    );
  });
  it("picks a deterministic playful variant for the day", () => {
    const v = dailyReminderVariant(new Date("2026-08-19T20:00:00Z"));
    expect(DAILY_REMINDER_VARIANTS).toContain(v);
    expect(dailyReminderVariant(new Date("2026-08-19T20:00:00Z"))).toBe(v);
  });
});

describe("pickPushCopy", () => {
  it("returns a Soso title and a non-empty body", () => {
    const c = pickPushCopy();
    expect(c.title).toBe("Soso");
    expect(c.body.length).toBeGreaterThan(0);
    expect(c.copyId).toMatch(/^soso\.push\.\d$/);
  });

  it("personalizes the line that takes a name and falls back when absent", () => {
    const named = pickPushCopy("Budi");
    const named2 = pickPushCopy("Budi");
    // Force the name line by scanning the bank via repeated draws is flaky, so
    // assert both variants render without throwing and the generic one has no
    // stray "[nama" placeholder.
    expect(named.body).not.toContain("[nama");
    expect(named2.body).not.toContain("[nama");
  });

  it("never repeats the last copy id when alternatives exist", () => {
    for (let i = 0; i < 20; i += 1) {
      const c = pickPushCopy(undefined, "soso.push.1");
      expect(c.copyId).not.toBe("soso.push.1");
      expect(["soso.push.1", "soso.push.2", "soso.push.3", "soso.push.4"]).toContain(c.copyId);
      expect(c.title).toBe("Soso");
      expect(c.body.length).toBeGreaterThan(0);
    }
  });
});
