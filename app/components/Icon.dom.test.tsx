import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import Icon from "./Icon";

describe("Icon", () => {
  it("renders an inline svg and is hidden from assistive tech", () => {
    const { container } = render(<Icon name="theme" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
  });

  it("draws every named glyph without throwing", () => {
    const names = [
      "theme",
      "sun",
      "moon",
      "menu",
      "plus",
      "search",
      "download",
      "save",
      "bell",
      "book",
      "chevron-down",
      "close",
      "check",
      "trash",
      "backup",
      "account",
    ] as const;
    for (const name of names) {
      const { container } = render(<Icon name={name} />);
      expect(container.querySelector("svg")).toBeInTheDocument();
    }
  });

  it("applies a custom className (e.g. to size/colour via text-brand-*)", () => {
    const { container } = render(<Icon name="menu" className="size-6 text-brand-600" />);
    expect(container.querySelector("svg")).toHaveClass("size-6", "text-brand-600");
  });
});
