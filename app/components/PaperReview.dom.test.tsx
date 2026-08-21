import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaperReview from "./PaperReview";
import type { CandidatePaper } from "../lib/types";

function paper(over: Partial<CandidatePaper> = {}): CandidatePaper {
  return {
    id: "p1",
    title: "Judul Paper",
    authors: "Penulis, A.",
    year: 2020,
    abstract: "Abstrak singkat.",
    citationCount: 10,
    relevanceScore: 0.9,
    sourceUrl: "https://example.com/p1",
    fullTextAvailable: false,
    approved: false,
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PaperReview", () => {
  it("exposes the single approve action and a decline, with text-based status", () => {
    const onConfirm = vi.fn();
    render(
      <PaperReview
        topicId="t1"
        title="Topik"
        papers={[paper({ approved: true })]}
        busy={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Approve & lanjut/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Batal" })).toBeInTheDocument();

    // Status conveyed by text, not colour: the checkbox is named after the title.
    expect(screen.getByRole("checkbox", { name: /Judul Paper/ })).toBeInTheDocument();
    expect(screen.getByText("Judul Paper")).toBeInTheDocument();
  });

  it("pre-checks papers that clear the relevance heuristic and excludes the weak tail", () => {
    // 8 candidates, none pre-approved -> the top-quartile (2) start checked.
    const papers = Array.from({ length: 8 }, (_, i) =>
      paper({ id: `p${i}`, title: `Paper ${i}`, relevanceScore: i >= 6 ? 0.9 : 0.1 }),
    );
    render(
      <PaperReview
        topicId="t1"
        title="Topik"
        papers={papers}
        busy={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const checked = screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked);
    expect(checked).toHaveLength(2);
    // The count is surfaced in the primary action too.
    expect(screen.getByRole("button", { name: /Approve & lanjut \(2\)/ })).toBeInTheDocument();
  });

  it("restores the student's stored approvals instead of re-applying the heuristic", () => {
    // A previously-excluded paper must not be silently resurrected on revisit.
    const papers = [
      paper({ id: "a", title: "Strukturalisme", relevanceScore: 0.99, approved: false }),
      paper({ id: "b", title: "Interpretivisme", relevanceScore: 0.1, approved: true }),
    ];
    render(
      <PaperReview
        topicId="t1"
        title="Topik"
        papers={papers}
        busy={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Highest relevance, but the student had excluded it -> stays unchecked.
    expect(
      (screen.getByRole("checkbox", { name: /Strukturalisme/ }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole("checkbox", { name: /Interpretivisme/ }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("approves the currently-checked papers in one action", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <PaperReview
        topicId="t1"
        title="Topik"
        papers={[paper({ id: "p1", approved: true }), paper({ id: "p2", title: "Kedua", approved: true })]}
        busy={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Approve & lanjut/ }));
    expect(onConfirm).toHaveBeenCalledWith("t1", ["p1", "p2"]);
  });

  it("blocks synthesis with a message when nothing is checked, never auto-approving nothing", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <PaperReview
        topicId="t1"
        title="Topik"
        papers={[paper({ id: "p1", approved: true })]}
        busy={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    // Uncheck the only paper, then try to proceed.
    await user.click(screen.getByRole("checkbox", { name: /Judul Paper/ }));
    await user.click(screen.getByRole("button", { name: /Approve & lanjut/ }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/minimal satu paper/i);
  });

  it("lets the student manually uncheck to exclude a paper without it being required", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <PaperReview
        topicId="t1"
        title="Topik"
        papers={[paper({ id: "p1", approved: true }), paper({ id: "p2", title: "Kedua", approved: true })]}
        busy={false}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: /Kedua/ }));
    await user.click(screen.getByRole("button", { name: /Approve & lanjut/ }));
    expect(onConfirm).toHaveBeenCalledWith("t1", ["p1"]);
  });
});
