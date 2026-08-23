import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import LoadingPanel from "./LoadingPanel";

/**
 * GAP 1 regression: submitting a topic used to leave the screen unchanged for
 * ~10s (the only feedback was an `sr-only` live region), which reads as broken
 * rather than slow. These tests pin the two properties that make the wait feel
 * alive: the panel is on screen immediately, and its label advances.
 */
afterEach(() => {
  vi.useRealTimers();
});

const STAGES = ["Mencari paper…", "Menilai relevansi…", "Menyusun daftar kandidat…"] as const;

describe("LoadingPanel", () => {
  it("shows the title, the first stage and the skeleton immediately (no empty frame)", () => {
    render(
      <LoadingPanel title="Mencari paper untuk topik ini…" stages={STAGES}>
        <div data-testid="skeleton" />
      </LoadingPanel>,
    );
    expect(screen.getByText("Mencari paper untuk topik ini…")).toBeInTheDocument();
    expect(screen.getByText("Mencari paper…")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  it("is an aria-busy live status region, not a focus-trapping dialog", () => {
    render(<LoadingPanel title="Menyusun modul…" stages={STAGES} />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("advances the staged label on the timer and stops on the last stage", () => {
    vi.useFakeTimers();
    render(<LoadingPanel title="Mencari…" stages={STAGES} stageMs={2000} />);

    expect(screen.getByText("Mencari paper…")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Menilai relevansi…")).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByText("Menyusun daftar kandidat…")).toBeInTheDocument();

    // Never wraps back to stage 1 — a looping label reads as "it restarted".
    act(() => void vi.advanceTimersByTime(10000));
    expect(screen.getByText("Menyusun daftar kandidat…")).toBeInTheDocument();
    expect(screen.queryByText("Mencari paper…")).toBeNull();
  });

  it("prefers real measured progress over the staged guess", () => {
    vi.useFakeTimers();
    render(<LoadingPanel title="Menyusun modul…" stages={STAGES} detail="1200 karakter tersusun…" />);
    expect(screen.getByText("1200 karakter tersusun…")).toBeInTheDocument();
    expect(screen.queryByText("Mencari paper…")).toBeNull();
  });

  it("clears its timer on unmount (no stray interval after the wait ends)", () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<LoadingPanel title="Menyusun…" stages={STAGES} />);
    unmount();
    expect(clear).toHaveBeenCalled();
  });
});
