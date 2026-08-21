import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AskStep from "./AskStep";
import type { ModuleDetail } from "../lib/types";

const DETAIL: ModuleDetail = {
  id: "mod-1",
  topicId: "topic-1",
  topicTitle: "Teori Praktik Bourdieu",
  contentMarkdown: "## Konsep kunci\n\nHabitus adalah disposisi.",
  generatedAt: "2026-08-18T06:00:00.000Z",
  wordCount: null,
  pageCount: null,
  essayPrompt: "",
  essayRubric: "",
  courses: [],
  sourcePapers: [],
  versions: [],
};

function setup(overrides: Partial<Parameters<typeof AskStep>[0]> = {}) {
  const postJSON = vi.fn(async () => ({ answer: "Jawaban." }));
  const onRecallDone = vi.fn();
  const onError = vi.fn();
  const onStatus = vi.fn();
  render(
    <AskStep
      detail={DETAIL}
      online
      postJSON={postJSON}
      recallDone
      onRecallDone={onRecallDone}
      onError={onError}
      onStatus={onStatus}
      {...overrides}
    />,
  );
  return { postJSON, onRecallDone, onError, onStatus };
}

describe("AskStep", () => {
  it("shows the free-recall gate before recall is done", () => {
    setup({ recallDone: false });
    expect(
      screen.getByRole("heading", { name: /Tulis dulu yang Anda ingat/ }),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Tanya sesuatu/)).not.toBeInTheDocument();
  });

  it("opens the Q&A after recall and labels the rewrite button in Indonesian", async () => {
    const user = userEvent.setup();
    const { onRecallDone } = setup({ recallDone: true });
    expect(screen.getByPlaceholderText(/Tanya sesuatu/)).toBeInTheDocument();
    // Microcopy must not be the old English 'brain dump'.
    const rewrite = screen.getByRole("button", { name: "Tulis ulang ingatan" });
    await user.click(rewrite);
    // The component is controlled: it asks the parent to drop recall so the
    // free-recall gate re-appears (the parent re-renders with recallDone=false).
    expect(onRecallDone).toHaveBeenCalledWith(false);
  });

  it("asks for a question before calling the API", async () => {
    const user = userEvent.setup();
    const { postJSON, onError } = setup({ recallDone: true });
    await user.click(screen.getByRole("button", { name: "Tanya" }));
    expect(postJSON).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("Tulis pertanyaan dulu.");
  });

  it("sends the question to the module-scoped Q&A endpoint", async () => {
    const user = userEvent.setup();
    const { postJSON } = setup({ recallDone: true });
    await user.type(screen.getByPlaceholderText(/Tanya sesuatu/), "Apa itu habitus?");
    await user.click(screen.getByRole("button", { name: "Tanya" }));
    expect(postJSON).toHaveBeenCalledWith("/api/qa", {
      moduleId: "mod-1",
      question: "Apa itu habitus?",
      topicId: "topic-1",
    });
  });
});
