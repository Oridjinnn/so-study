import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CalibrationPanel from "./CalibrationPanel";
import type { AssessmentAttempt } from "../lib/types";

function attempt(i: number, isCorrect: boolean, confidence: number): AssessmentAttempt {
  return {
    id: `a${i}`,
    moduleId: "m1",
    topicId: "t1",
    questionType: "mcq",
    itemRef: `q${i}`,
    prompt: `Prompt ${i}`,
    response: null,
    score: null,
    isCorrect,
    confidence,
    answeredAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    intervalDays: 1,
    repetitions: 1,
    easeFactor: 2.5,
    stability: 1,
    difficulty: 5,
    scheduledNextAt: null,
  };
}

describe("CalibrationPanel", () => {
  it("renders the predicted-vs-actual bars when there is enough rated data", () => {
    const attempts = [
      attempt(0, true, 4),
      attempt(1, true, 5),
      attempt(2, false, 2),
    ];
    render(<CalibrationPanel attempts={attempts} />);

    expect(screen.getByText("Perkiraan (rasa yakin)")).toBeInTheDocument();
    expect(screen.getByText("Kenyataan (jawaban benar)")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Perkiraan/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Kenyataan/ })).toBeInTheDocument();
  });

  it("does not render bars before enough rated attempts", () => {
    const attempts = [attempt(0, true, 4)];
    render(<CalibrationPanel attempts={attempts} />);
    expect(screen.queryByText("Perkiraan (rasa yakin)")).not.toBeInTheDocument();
    expect(screen.getByText(/Belum cukup data/)).toBeInTheDocument();
  });
});
