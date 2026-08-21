import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewGrader, { type ReviewGrade } from "./ReviewGrader";

describe("ReviewGrader", () => {
  it("renders the four grade buttons Again/Hard/Good/Easy", () => {
    render(<ReviewGrader onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /Lagi/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sulit/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bagus/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mudah/ })).toBeInTheDocument();
  });

  it("marks Bagus (Good) as the recommended default option", () => {
    render(<ReviewGrader onSelect={() => {}} />);
    const good = screen.getByRole("button", { name: /Bagus/ });
    expect(good.className).toContain("ring-brand-500");
    expect(good.className).toContain("border-brand-500");
  });

  it("fires the matching grade callback when keys 1-4 are pressed", () => {
    const onSelect = vi.fn();
    render(<ReviewGrader onSelect={onSelect} keyboard />);

    fireEvent.keyDown(document, { key: "1" });
    expect(onSelect).toHaveBeenCalledWith("again", 1);

    fireEvent.keyDown(document, { key: "2" });
    expect(onSelect).toHaveBeenCalledWith("hard", 3);

    fireEvent.keyDown(document, { key: "3" });
    expect(onSelect).toHaveBeenCalledWith<[ReviewGrade, number]>("good", 4);

    fireEvent.keyDown(document, { key: "4" });
    expect(onSelect).toHaveBeenCalledWith("easy", 5);
  });

  it("selects a grade when its button is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ReviewGrader onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /Mudah/ }));
    expect(onSelect).toHaveBeenCalledWith("easy", 5);
  });
});
