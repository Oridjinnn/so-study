import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Markdown from "./markdown";
import { slugifyHeading } from "./study";

describe("Markdown headings", () => {
  it("renders h2/h3 with slug ids so the TOC can jump to them", () => {
    render(<Markdown text={"## Konsep Kunci\n\n### Habitus dan Modal"} />);

    const h2 = screen.getByRole("heading", { level: 2, name: "Konsep Kunci" });
    const h3 = screen.getByRole("heading", { level: 3, name: "Habitus dan Modal" });
    expect(h2).toHaveAttribute("id", slugifyHeading("Konsep Kunci"));
    expect(h3).toHaveAttribute("id", slugifyHeading("Habitus dan Modal"));
  });

  it("renders an h1 without an anchor id (the TOC only indexes h2/h3)", () => {
    render(<Markdown text="# Judul Modul" />);
    expect(screen.getByRole("heading", { level: 1, name: "Judul Modul" })).not.toHaveAttribute("id");
  });
});

describe("Markdown inline formatting", () => {
  it("renders bold, italic and code spans", () => {
    render(<Markdown text="Ada **tebal**, *miring*, dan `kode` di sini." />);
    expect(screen.getByText("tebal").tagName).toBe("STRONG");
    expect(screen.getByText("miring").tagName).toBe("EM");
    expect(screen.getByText("kode").tagName).toBe("CODE");
  });

  it("keeps the surrounding prose intact", () => {
    render(<Markdown text="Habitus adalah **disposisi** terinternalisasi." />);
    expect(screen.getByText(/Habitus adalah/)).toBeInTheDocument();
    expect(screen.getByText(/terinternalisasi\./)).toBeInTheDocument();
  });
});

describe("Markdown citations (grounding)", () => {
  it("turns [n] into a button that reports which source was clicked", async () => {
    const onCite = vi.fn();
    render(<Markdown text="Klaim penting [2] menurut sumber." onCite={onCite} />);

    await userEvent.click(screen.getByRole("button", { name: "2" }));
    expect(onCite).toHaveBeenCalledWith(2);
  });

  it("labels the citation button for VoiceOver", () => {
    render(<Markdown text="Klaim [3]." onCite={vi.fn()} />);
    expect(screen.getByRole("button", { name: "3" })).toHaveAttribute("title", "Lihat sumber 3");
  });

  it("still shows the citation number when no jump handler is supplied", () => {
    render(<Markdown text="Klaim [1] tanpa handler." />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders every citation in a paragraph, not just the first", async () => {
    const onCite = vi.fn();
    render(<Markdown text="Klaim A [1] lalu klaim B [2]." onCite={onCite} />);

    await userEvent.click(screen.getByRole("button", { name: "1" }));
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    expect(onCite).toHaveBeenNthCalledWith(1, 1);
    expect(onCite).toHaveBeenNthCalledWith(2, 2);
  });
});

describe("Markdown blocks", () => {
  it("renders bullet lists as a ul with one li per item", () => {
    render(<Markdown text={"- satu\n- dua\n- tiga"} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("satu");
  });

  it("renders numbered lists as an ol", () => {
    const { container } = render(<Markdown text={"1. pertama\n2. kedua"} />);
    expect(container.querySelector("ol")).not.toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders a blockquote", () => {
    const { container } = render(<Markdown text="> kutipan penting" />);
    expect(container.querySelector("blockquote")).toHaveTextContent("kutipan penting");
  });

  it("joins wrapped lines into one paragraph and separates blank-line blocks", () => {
    const { container } = render(<Markdown text={"baris satu\nlanjutan\n\nparagraf dua"} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent("baris satu lanjutan");
    expect(paragraphs[1]).toHaveTextContent("paragraf dua");
  });

  it("renders a horizontal rule for ---", () => {
    const { container } = render(<Markdown text={"awal\n\n---\n\nakhir"} />);
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders nothing for empty text", () => {
    const { container } = render(<Markdown text="" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
