import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReadStep from "./ReadStep";

const MODULE = [
  "## Tujuan Pembelajaran",
  "- Setelah membaca modul ini, kamu bisa: paham",
  "",
  "## Mengapa topik ini penting",
  "karena penting",
  "",
  "## Konsep kunci & definisi",
  "### Konsep A",
  "definisi A panjang",
  "### Konsep B",
  "definisi B panjang",
  "",
  "## Perbandingan antar konsep",
  "TEKS_KHUSUS_PERBANDINGAN",
  "",
  "## Rangkuman bab",
  "TEKS_KHUSUS_RANGKUMAN",
  "",
  "## Daftar istilah kunci",
  "glosarium",
].join("\n");

function renderRead(props: Partial<React.ComponentProps<typeof ReadStep>> = {}) {
  return render(
    <ReadStep
      topicId="topic-1"
      moduleId="mod-1"
      contentMarkdown={MODULE}
      pretestDone
      onPretestDone={() => {}}
      onCite={() => {}}
      {...props}
    />,
  );
}

describe("ReadStep — preview reframed as teaser for the PDF", () => {
  it("shows the preview card and the full-PDF download link with the correct href", () => {
    renderRead();
    expect(screen.getByText(/Ini pratinjau modul/i)).toBeInTheDocument();
    const pdf = screen.getByRole("link", { name: /Unduh modul lengkap \(PDF\)/i });
    expect(pdf).toHaveAttribute("href", "/api/modules/mod-1/export?format=pdf");
  });

  it("cuts the preview at the end of section 3 (Konsep kunci), hiding later sections", () => {
    renderRead();
    expect(screen.queryByText("TEKS_KHUSUS_PERBANDINGAN")).not.toBeInTheDocument();
    expect(screen.queryByText("TEKS_KHUSUS_RANGKUMAN")).not.toBeInTheDocument();
    // section 3 content is present
    expect(screen.getByText(/definisi A panjang/)).toBeInTheDocument();
  });

  it('"Lanjutkan baca di sini" reveals the rest in-app without navigation', async () => {
    const user = userEvent.setup();
    renderRead();
    await user.click(screen.getByRole("button", { name: /Lanjutkan baca di sini/i }));
    // later sections now visible
    expect(screen.getByText("TEKS_KHUSUS_PERBANDINGAN")).toBeInTheDocument();
    expect(screen.getByText("TEKS_KHUSUS_RANGKUMAN")).toBeInTheDocument();
    // the preview nudge is gone; nothing redirected
    expect(screen.queryByText(/Ini pratinjau modul/i)).not.toBeInTheDocument();
  });

  it("omits the PDF link when no moduleId is supplied, but keeps the in-app continue", () => {
    renderRead({ moduleId: undefined });
    expect(screen.queryByRole("link", { name: /Unduh modul lengkap \(PDF\)/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lanjutkan baca di sini/i })).toBeInTheDocument();
  });

  it("sources the page count from the stored field, not a client guess", () => {
    const { rerender } = renderRead({ pageCount: 8 });
    expect(screen.getByText(/Halaman 1 \/ 8/)).toBeInTheDocument();
    // below target -> honest non-blocking note
    expect(screen.getByText(/Modul ini agak lebih ringkas dari target 10 halaman/i)).toBeInTheDocument();

    rerender(
      <ReadStep
        topicId="topic-1"
        moduleId="mod-1"
        contentMarkdown={MODULE}
        pageCount={12}
        pretestDone
        onPretestDone={() => {}}
        onCite={() => {}}
      />,
    );
    expect(screen.getByText(/Halaman 1 \/ 12/)).toBeInTheDocument();
    expect(
      screen.queryByText(/Modul ini agak lebih ringkas dari target 10 halaman/i),
    ).not.toBeInTheDocument();
  });
});
