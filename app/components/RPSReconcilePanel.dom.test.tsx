import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RPSReconcilePanel from "./RPSReconcilePanel";
import type { RPSState } from "../lib/types";

// Mock the PDF parser so the DOM test stays deterministic and never spins up
// the real pdfjs worker in jsdom. We feed it a small buffer and assert the
// extracted text lands in the review textarea (not auto-submitted).
vi.mock("../lib/pdfExtract", () => ({
  extractPdfText: vi.fn(async () => "Minggu 1: Pengantar\nMinggu 2: Evolusi Kebudayaan"),
}));

function state(over: Partial<RPSState> = {}): RPSState {
  return {
    courseId: "c1",
    courseName: "Teori Antropologi",
    hasOfficialOrder: true,
    officialOrder: ["Teori A", "Teori B"],
    rows: [
      {
        title: "Teori A",
        topicId: "t1",
        officialPosition: 1,
        customPosition: 1,
        delta: 0,
        status: "aligned",
      },
      {
        title: "Teori B",
        topicId: "t2",
        officialPosition: 2,
        customPosition: 3,
        delta: 1,
        status: "moved",
      },
    ],
    summary: { aligned: 1, moved: 1, notInOfficial: 0, notStarted: 0 },
    reconciledAt: "2026-08-19T00:00:00.000Z",
    unverifiedCount: 1,
    ...over,
  };
}

function mockFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const body = impl(String(url), init);
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RPSReconcilePanel", () => {
  it("shows the diff for a course that already has an official order", async () => {
    mockFetch(() => state());
    render(<RPSReconcilePanel courseId="c1" onClose={vi.fn()} />);

    // Both alignment states are named in text, not only colour-coded.
    expect(await screen.findByText("Urutan cocok")).toBeInTheDocument();
    expect(screen.getByText("Beda posisi")).toBeInTheDocument();
    expect(screen.getByText("Teori A")).toBeInTheDocument();
    expect(screen.getByText("Teori B")).toBeInTheDocument();
  });

  it("explains the size and direction of a mismatch", async () => {
    mockFetch(() => state());
    render(<RPSReconcilePanel courseId="c1" onClose={vi.fn()} />);
    // Teori B: official #2, studied 3rd -> one position later than the lecturer.
    expect(await screen.findByText(/RPS #2 · milikmu #3 \(1 posisi lebih lambat\)/)).toBeInTheDocument();
  });

  it("opens straight into the input when nothing has been reconciled yet", async () => {
    mockFetch(() => state({ hasOfficialOrder: false, officialOrder: [], rows: [] }));
    render(<RPSReconcilePanel courseId="c1" onClose={vi.fn()} />);
    // An empty diff view would be a dead end for a first-time reconcile.
    expect(await screen.findByLabelText(/Urutan resmi/)).toBeInTheDocument();
  });

  it("PUTs the pasted order and shows the recomputed diff", async () => {
    const fetchMock = mockFetch(() => state({ hasOfficialOrder: false, officialOrder: [], rows: [] }));
    const onReconciled = vi.fn();
    const user = userEvent.setup();
    render(<RPSReconcilePanel courseId="c1" onClose={vi.fn()} onReconciled={onReconciled} />);

    const box = await screen.findByLabelText(/Urutan resmi/);
    await user.type(box, "Teori A\nTeori B");

    // The save response carries the reconciled diff.
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => state() }));
    await user.click(screen.getByRole("button", { name: /Simpan & bandingkan/ }));

    await waitFor(() => expect(onReconciled).toHaveBeenCalled());
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT");
    expect(put).toBeTruthy();
    expect(String((put![1] as RequestInit).body)).toContain("Teori A");
    expect(await screen.findByText("Urutan cocok")).toBeInTheDocument();
  });

  it("surfaces a load failure instead of showing a silently empty diff", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: "Mata kuliah tidak ditemukan." }),
      })),
    );
    render(<RPSReconcilePanel courseId="nope" onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/tidak ditemukan/);
  });

  it("cannot save an empty order", async () => {
    mockFetch(() => state({ hasOfficialOrder: false, officialOrder: [], rows: [] }));
    render(<RPSReconcilePanel courseId="c1" onClose={vi.fn()} />);
    await screen.findByLabelText(/Urutan resmi/);
    expect(screen.getByRole("button", { name: /Simpan & bandingkan/ })).toBeDisabled();
  });

  it("extracts uploaded PDF text into the textarea for review (not auto-submitted)", async () => {
    mockFetch(() => state({ hasOfficialOrder: false, officialOrder: [], rows: [] }));
    const onReconciled = vi.fn();
    const user = userEvent.setup();
    render(
      <RPSReconcilePanel courseId="c1" onClose={vi.fn()} onReconciled={onReconciled} />,
    );

    const input = await screen.findByLabelText(/Unggah PDF/i);
    await user.upload(
      input,
      new File([new Uint8Array([1, 2, 3, 4])], "rps.pdf", { type: "application/pdf" }),
    );

    // The extracted text is placed in the manual-entry field for the student
    // to review/edit before confirming — it must NOT auto-save.
    const box = (await screen.findByLabelText(/Urutan resmi/i)) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toMatch(/Minggu 1: Pengantar/));
    expect(box.value).toMatch(/Minggu 2: Evolusi Kebudayaan/);
    expect(onReconciled).not.toHaveBeenCalled();
    expect(screen.getByText(/review & sunting sebelum simpan/i)).toBeInTheDocument();
  });
});
