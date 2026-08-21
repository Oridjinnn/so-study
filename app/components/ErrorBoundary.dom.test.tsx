import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary from "./ErrorBoundary";

let shouldThrow = true;

function Bomb() {
  if (shouldThrow) throw new Error("boom");
  return <div>recovered</div>;
}

describe("ErrorBoundary", () => {
  it("shows a fallback with a reset button that restores the child", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Terjadi kesalahan")).toBeInTheDocument();
    const reset = screen.getByRole("button", { name: "Coba lagi" });
    expect(reset).toBeInTheDocument();

    // Stop throwing, then reset to re-render the child successfully.
    shouldThrow = false;
    await user.click(reset);

    expect(screen.getByText("recovered")).toBeInTheDocument();
    expect(screen.queryByText("Terjadi kesalahan")).not.toBeInTheDocument();

    spy.mockRestore();
    shouldThrow = true;
  });
});
