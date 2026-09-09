import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EmptyState from "./EmptyState";

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(
      <EmptyState title="No items" description="Add one to get started" />,
    );
    expect(screen.getByText("No items")).toBeInTheDocument();
    expect(screen.getByText("Add one to get started")).toBeInTheDocument();
  });

  it("action button fires onClick", () => {
    const onClick = vi.fn();
    render(<EmptyState title="Empty" action={{ label: "Add", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("renders default icon", () => {
    const { container } = render(<EmptyState title="Title" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <EmptyState title="Title" className="custom-class" />,
    );
    expect(container.querySelector(".empty-state")).toHaveClass("custom-class");
  });
});