import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ToastProvider, useToast, ToastContainer } from "./Toast";

function AddToast() {
  const { addToast } = useToast();
  return <button onClick={() => addToast("hello", "success")}>add</button>;
}

function ToastRenderer() {
  return <ToastContainer />;
}

function Adder() {
  const { addToast } = useToast();
  const [id, setId] = useState<string | null>(null);
  return (
    <>
      <button onClick={() => setId(addToast("hello", "success"))}>add</button>
      {id ? <Remover id={id} /> : null}
    </>
  );
}

function Remover({ id }: { id: string }) {
  const { removeToast } = useToast();
  return <button onClick={() => removeToast(id)}>remove</button>;
}

function Wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

describe("Toast", () => {
  it("addToast adds a toast", () => {
    render(
      <Wrapper>
        <AddToast />
        <ToastRenderer />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("removeToast removes a toast", () => {
    render(
      <Wrapper>
        <Adder />
        <ToastRenderer />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByText("hello")).toBeInTheDocument();
    fireEvent.click(screen.getByText("remove"));
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
  });

  it("auto-dismisses after timeout", () => {
    vi.useFakeTimers();
    render(
      <Wrapper>
        <AddToast />
        <ToastRenderer />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByText("hello")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4300);
    });
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("renders correct accent color per type", () => {
    function TypeToster() {
      const { addToast } = useToast();
      return (
        <button onClick={() => addToast("msg", "success")}>add</button>
      );
    }
    render(
      <Wrapper>
        <TypeToster />
        <ToastRenderer />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText("add"));
    const item = document.querySelector(".toast-container > div");
    expect(item).toHaveClass("border-green-500");
  });
});