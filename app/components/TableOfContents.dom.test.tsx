import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TableOfContents from "./TableOfContents";
import { slugifyHeading } from "@/app/lib/study";

const MODULE = [
  "# Judul modul",
  "",
  "## Konsep kunci",
  "isi",
  "### Habitus",
  "isi",
  "## Ringkasan",
].join("\n");

describe("TableOfContents", () => {
  it("lists every h2 and h3 in document order", () => {
    render(<TableOfContents markdown={MODULE} />);
    const entries = screen.getAllByRole("button").map((b) => b.textContent);
    expect(entries).toEqual(["Konsep kunci", "Habitus", "Ringkasan"]);
  });

  it("ignores h1 so the module title is not repeated as a section", () => {
    render(<TableOfContents markdown={MODULE} />);
    expect(screen.queryByRole("button", { name: "Judul modul" })).not.toBeInTheDocument();
  });

  it("exposes itself as a labelled landmark for VoiceOver", () => {
    render(<TableOfContents markdown={MODULE} />);
    expect(screen.getByRole("navigation", { name: "Daftar isi" })).toBeInTheDocument();
  });

  it("renders nothing when the module has no sections (Mayer segmenting is moot)", () => {
    const { container } = render(<TableOfContents markdown={"# Hanya judul\n\nprosa saja."} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("indents h3 entries under their h2 parent", () => {
    render(<TableOfContents markdown={MODULE} />);
    expect(screen.getByRole("button", { name: "Habitus" }).className).toContain("pl-5");
    expect(screen.getByRole("button", { name: "Konsep kunci" }).className).not.toContain("pl-5");
  });

  it("scrolls to the heading whose slug id matches the clicked entry", async () => {
    const target = document.createElement("h2");
    target.id = slugifyHeading("Konsep kunci");
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    document.body.appendChild(target);

    render(<TableOfContents markdown={MODULE} />);
    await userEvent.click(screen.getByRole("button", { name: "Konsep kunci" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth" });
    target.remove();
  });

  it("does not throw when the target heading is missing from the DOM", async () => {
    render(<TableOfContents markdown={MODULE} />);
    await expect(
      userEvent.click(screen.getByRole("button", { name: "Ringkasan" })),
    ).resolves.not.toThrow();
  });

  it("tolerates CRLF line endings", () => {
    render(<TableOfContents markdown={"## Satu\r\n\r\n## Dua"} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Satu", "Dua"]);
  });
});
