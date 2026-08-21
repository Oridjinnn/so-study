import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SosoReminder from "./SosoReminder";
import type { ProgressData, TopicProgress } from "../lib/types";

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

function progress(count: number, topics = 1): ProgressData {
  return {
    topics: topics > 0 ? [topic()] : [],
    dueTodayCount: 0,
    dueTodayByCourse: {},
    streakDays: 0,
    heatmap: [{ date: "2026-08-19", count }],
    avgMastery: null,
  };
}

const EXACT = "Hallo! Soso disini! Kamu belum belajar hari ini! hummft kamu ga kangen aku ya?!";

describe("SosoReminder", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the exact reminder when not studied today but has content", () => {
    render(<SosoReminder progress={progress(0, 1)} />);
    expect(screen.getByRole("status")).toHaveTextContent(EXACT);
  });

  it("does not show once studied today", () => {
    render(<SosoReminder progress={progress(4, 1)} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not show when there is nothing to study", () => {
    render(<SosoReminder progress={progress(0, 0)} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not show when progress is null", () => {
    render(<SosoReminder progress={null} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disappears after dismissal and stays dismissed for the Jakarta day", async () => {
    const user = userEvent.setup();
    render(<SosoReminder progress={progress(0, 1)} />);
    const banner = screen.getByRole("status");
    expect(banner).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Tutup pengingat Soso/i }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("soso.reminderDismissed:"));
    expect(keys).toHaveLength(1);
  });
});
