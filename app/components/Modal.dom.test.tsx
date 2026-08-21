import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Modal from "./Modal";

describe("Modal", () => {
  it("exposes an accessible dialog with aria-modal and a label", () => {
    render(
      <Modal open title="Tinjau paper" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    const label = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    expect(label).toHaveTextContent("Tinjau paper");
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="X" onClose={onClose}>
        <p>body</p>
      </Modal>,
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(
      <Modal open={false} title="X" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("focuses the first enabled control and skips disabled ones", () => {
    render(
      <Modal open title="X" onClose={() => {}}>
        <button type="button" disabled>
          disabled
        </button>
        <button type="button">enabled</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(screen.getByText("enabled"));
    expect(document.activeElement).not.toBe(dialog);
  });

  it("focuses the dialog container when no enabled focusable exists", () => {
    render(
      <Modal open title="X" onClose={() => {}}>
        <p>only text</p>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("returns focus to the trigger element on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "open";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <Modal open title="X" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    rerender(
      <Modal open={false} title="X" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it("shows a discard confirmation when confirmClose has content", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="X" onClose={onClose} confirmClose>
        <input defaultValue="typed" />
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Buang perubahan?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ya"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes immediately via Escape when confirmClose has no content", () => {
    const onClose = vi.fn();
    render(
      <Modal open title="X" onClose={onClose} confirmClose>
        <input defaultValue="" />
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores it on close", () => {
    const { rerender } = render(
      <Modal open title="X" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    rerender(
      <Modal open={false} title="X" onClose={() => {}}>
        <p>body</p>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("");
  });
});
