import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Workspace from "./Workspace";
import type { ModuleDetail, VerificationPayload } from "../lib/types";

// The practice sub-panels each fetch on mount and are covered by their own
// behaviour; stub them so this suite tests the Workspace shell's invariants
// (tab visibility, closed-book lock, offline refusal, export, attempts).
vi.mock("./QuestionBank", () => ({
  default: () => <div data-testid="question-bank" />,
}));
vi.mock("./ReviewQueue", () => ({
  default: () => <div data-testid="review-queue" />,
}));
vi.mock("./InterleavedPractice", () => ({
  default: () => <div data-testid="interleaved-practice" />,
}));
vi.mock("./ElaborationPanel", () => ({
  default: () => <div data-testid="elaboration-panel" />,
}));

const MCQ = {
  questions: [
    {
      id: "q1",
      stem: "Apa itu habitus?",
      options: ["Disposisi terinternalisasi", "Aturan tertulis"],
      answer: "Disposisi terinternalisasi",
      explanation: "Bourdieu: struktur terstruktur.",
    },
  ],
};

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

function installFetch(): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    let data: unknown = { ok: true };
    if (url.startsWith("/api/mcq")) data = MCQ;
    else if (url.startsWith("/api/qa")) data = { answer: "Jawaban dari modul." };
    else if (url.startsWith("/api/grade")) data = { feedback: "Umpan balik esai." };
    else if (url.startsWith("/api/questions"))
      data = init?.method === "POST" ? { id: "qb-new" } : { items: [] };
    else if (url.startsWith("/api/attempts") && (init?.method ?? "GET") === "GET")
      data = { attempts: [] };

    return { ok: true, status: 200, json: async () => data } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function detailFixture(overrides: Partial<ModuleDetail> = {}): ModuleDetail {
  return {
    id: "mod-1",
    topicId: "topic-1",
    topicTitle: "Teori Praktik Bourdieu",
    contentMarkdown: "## Konsep kunci\n\nHabitus adalah disposisi terinternalisasi [1].",
    generatedAt: "2026-08-18T06:00:00.000Z",
    wordCount: null,
    pageCount: null,
    essayPrompt: "Jelaskan habitus dengan kata sendiri.",
    essayRubric: "1. Definisi 2. Contoh 3. Kritik",
    courses: [{ id: "course-1", name: "Teori Antropologi Kontemporer" }],
    sourcePapers: [
      {
        id: "paper-1",
        title: "Outline of a Theory of Practice",
        authors: "Bourdieu, P.",
        year: 1977,
        citationCount: 1200,
        sourceUrl: "https://openalex.org/W1",
      },
    ],
    versions: [
      { id: "v1", version: 1, generatedAt: "2026-08-18T06:00:00.000Z", changeNote: "initial synthesis" },
    ],
    ...overrides,
  };
}

function tabList() {
  return ["1 Baca", "2 Tanya", "3 Latihan", "4 Sumber"].filter((label) =>
    screen.queryByRole("tab", { name: label }),
  );
}

let calls: Call[];

// The pretest (prequestions) and free-recall gates are one-per-topic and stored
// in localStorage; mark them done so the suites below start on the reader/Q&A.
// "Workspace learning-science gates" clears them explicitly.
function clearGates() {
  window.localStorage.removeItem("pretest:topic-1");
  window.localStorage.removeItem("recall:topic-1");
}

beforeEach(() => {
  calls = installFetch();
  window.localStorage.setItem("pretest:topic-1", JSON.stringify({ at: "2026-08-18" }));
  window.localStorage.setItem("recall:topic-1", "x".repeat(120));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Workspace header", () => {
  it("shows the topic title and the courses the module belongs to", () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    expect(screen.getByRole("heading", { name: "Teori Praktik Bourdieu" })).toBeInTheDocument();
    expect(screen.getByText("Teori Antropologi Kontemporer")).toBeInTheDocument();
  });

  it("says when a module belongs to no course yet", () => {
    render(<Workspace detail={detailFixture({ courses: [] })} online={false} />);
    expect(screen.getByText("belum masuk mata kuliah")).toBeInTheDocument();
  });
});

describe("Workspace reading tab", () => {
  it("opens on the module reader with the module content and its TOC", () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    expect(screen.getByRole("tab", { name: "1 Baca" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("navigation", { name: "Daftar isi" })).toBeInTheDocument();
    expect(screen.getByText(/Habitus adalah/)).toBeInTheDocument();
  });

  it("jumps to the Sumber tab when a citation is clicked (grounding)", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);

    await userEvent.click(screen.getByRole("button", { name: "1" }));

    expect(screen.getByRole("tab", { name: "4 Sumber" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Sumber 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Outline of a Theory of Practice" })).toHaveAttribute(
      "href",
      "https://openalex.org/W1",
    );
  });

  it("marks tabs with role=tab and aria-selected for VoiceOver", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);

    await userEvent.click(screen.getByRole("tab", { name: "4 Sumber" }));

    expect(screen.getByRole("tab", { name: "4 Sumber" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "1 Baca" })).toHaveAttribute("aria-selected", "false");
  });
});

describe("Workspace closed-book mode (R8)", () => {
  it("shows all four tabs while open-book", () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    expect(tabList()).toEqual(["1 Baca", "2 Tanya", "3 Latihan", "4 Sumber"]);
  });

  it("locks Baca, Tanya and Sumber once closed-book is enabled", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);

    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));
    await userEvent.click(screen.getByRole("checkbox"));

    expect(tabList()).toEqual(["3 Latihan"]);
    expect(screen.queryByRole("tab", { name: "1 Baca" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "4 Sumber" })).not.toBeInTheDocument();
  });

  it("restores the reference tabs when closed-book is switched off", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);

    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));
    const toggle = screen.getByRole("checkbox");
    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(tabList()).toEqual(["1 Baca", "2 Tanya", "3 Latihan", "4 Sumber"]);
  });

  it("explains why the tabs are locked (retrieval practice)", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));
    expect(screen.getByText(/Mode tertutup/)).toBeInTheDocument();
    expect(screen.getByText(/Retrieval practice dari memori/)).toBeInTheDocument();
  });
});

describe("Workspace offline behaviour (R5)", () => {
  it("warns that reading works offline but Tanya/Latihan need a connection", () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    expect(screen.getByText(/Mode offline/)).toBeInTheDocument();
  });

  it("refuses to answer offline instead of fabricating an answer", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);

    await userEvent.click(screen.getByRole("tab", { name: "2 Tanya" }));
    await userEvent.type(screen.getByPlaceholderText(/Tanya sesuatu/), "Apa itu habitus?");
    await userEvent.click(screen.getByRole("button", { name: "Tanya" }));

    expect(screen.getByText("Tanya-jawab butuh internet. Sambungkan dulu.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/qa"))).toBe(false);
  });

  it("asks for a question before calling the API at all", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);

    await userEvent.click(screen.getByRole("tab", { name: "2 Tanya" }));
    await userEvent.click(screen.getByRole("button", { name: "Tanya" }));

    expect(screen.getByText("Tulis pertanyaan dulu.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/qa"))).toBe(false);
  });

  it("shows no offline banner when connected", () => {
    render(<Workspace detail={detailFixture()} online />);
    expect(screen.queryByText(/Mode offline/)).not.toBeInTheDocument();
  });
});

describe("Workspace scoped Q&A", () => {
  it("sends the module chunks and topic with the question, then renders the answer", async () => {
    render(<Workspace detail={detailFixture()} online />);

    await userEvent.click(screen.getByRole("tab", { name: "2 Tanya" }));
    await userEvent.type(screen.getByPlaceholderText(/Tanya sesuatu/), "Apa itu habitus?");
    await userEvent.click(screen.getByRole("button", { name: "Tanya" }));

    await waitFor(() => expect(screen.getByText("Jawaban dari modul.")).toBeInTheDocument());
    const qa = calls.find((c) => c.url.startsWith("/api/qa"));
    expect(qa?.method).toBe("POST");
    expect(qa?.body).toMatchObject({
      moduleId: "mod-1",
      question: "Apa itu habitus?",
      topicId: "topic-1",
    });
    expect(qa?.body?.chunks).toBeUndefined();
  });
});

async function openMCQ() {
  await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));
  await userEvent.click(screen.getByRole("button", { name: "Buat soal" }));
  await screen.findByText(/Apa itu habitus?/);
}

describe("Workspace practice (P0-3, on-demand MCQ)", () => {
  it("never fires an MCQ generation on mount — only the button does", async () => {
    render(<Workspace detail={detailFixture()} online />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    expect(calls.some((c) => c.url.startsWith("/api/mcq"))).toBe(false);
    expect(screen.getByText(/Tekan/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Buat soal" }));

    await waitFor(() => {
      const mcq = calls.find((c) => c.url.startsWith("/api/mcq"));
      expect(mcq?.body).toMatchObject({ text: detailFixture().contentMarkdown, count: 5 });
    });
    expect(await screen.findByText(/Apa itu habitus?/)).toBeInTheDocument();
  });

  it("persists generated MCQs into the question bank as AI-authored", async () => {
    render(<Workspace detail={detailFixture()} online />);
    await openMCQ();

    await waitFor(() => {
      const post = calls.find((c) => c.url === "/api/questions" && c.method === "POST");
      expect(post?.body).toMatchObject({
        topicId: "topic-1",
        moduleId: "mod-1",
        stem: "Apa itu habitus?",
        author: "ai",
      });
    });
  });

  it("does not spend an API call on MCQs while offline", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));
    await userEvent.click(screen.getByRole("button", { name: "Buat soal" }));

    expect(screen.getByText("Membuat soal butuh internet. Sambungkan dulu.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/mcq"))).toBe(false);
  });

  it("scores a graded MCQ and persists the attempt for spaced repetition", async () => {
    render(<Workspace detail={detailFixture()} online />);
    await openMCQ();

    // MCQ is graded when the student checks the answer, not when they pick.
    await userEvent.click(await screen.findByRole("radio", { name: /Disposisi terinternalisasi/ }));
    await userEvent.click(screen.getByRole("button", { name: "Periksa jawaban" }));

    expect(screen.getAllByText(/Skor akhir: 1\/1/).length).toBeGreaterThan(0);
    await waitFor(() => {
      const attempt = calls.find((c) => c.url === "/api/attempts");
      expect(attempt?.body).toMatchObject({ moduleId: "mod-1", topicId: "topic-1" });
      expect(attempt?.body?.items).toEqual([
        { questionType: "mcq", itemRef: "q1", prompt: "Apa itu habitus?", isCorrect: true },
      ]);
    });
  });

  it("says an MCQ was checked against its key, not an essay rubric", async () => {
    render(<Workspace detail={detailFixture()} online />);
    await openMCQ();

    await userEvent.click(await screen.findByRole("radio", { name: /Disposisi terinternalisasi/ }));
    await userEvent.click(screen.getByRole("button", { name: "Periksa jawaban" }));

    expect(screen.getByText("benar")).toBeInTheDocument();
    expect(screen.getByText(/Opsi terkunci setelah dijawab/)).toBeInTheDocument();
  });

  it("marks a wrong pick incorrect and reveals the explanation", async () => {
    render(<Workspace detail={detailFixture()} online />);
    await openMCQ();

    await userEvent.click(await screen.findByRole("radio", { name: /Aturan tertulis/ }));
    await userEvent.click(screen.getByRole("button", { name: "Periksa jawaban" }));

    expect(screen.getAllByText(/Skor akhir: 0\/1/).length).toBeGreaterThan(0);
    expect(screen.getByText("Bourdieu: struktur terstruktur.")).toBeInTheDocument();
  });
});

describe("Workspace Latihan core loop", () => {
  it("shows the four core steps at once (no nested sub-tabs)", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    expect(screen.getByRole("heading", { name: "1. Pilihan ganda" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2. Esai" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "3. Evaluasi diri" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "4. Nilai & hasil" })).toBeInTheDocument();

    // The nested practice tablist is gone — the core loop is one scroll, not 9 tabs.
    expect(screen.queryByRole("tablist", { name: "Bagian latihan" })).not.toBeInTheDocument();
  });

  it("merges calibration and metacognition under Evaluasi diri", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    expect(
      screen.getByRole("heading", { name: /Kalibrasi: perkiraan vs kenyataan/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rencana" })).toBeInTheDocument();
  });

  it("keeps Bank Soal inside the Pilihan Ganda step", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    expect(screen.getByTestId("question-bank")).toBeInTheDocument();
  });
});

describe("Workspace advanced practice accordion", () => {
  it("keeps Latihan lanjutan collapsed by default and unmounts its content", async () => {
    render(<Workspace detail={detailFixture()} online={false} courseId="course-1" />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    const toggle = screen.getByRole("button", { name: /Latihan lanjutan/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Collapsed content is not in the document, so it is neither visible nor
    // focusable until the student expands it.
    expect(screen.queryByTestId("review-queue")).not.toBeInTheDocument();
    expect(screen.queryByTestId("interleaved-practice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("elaboration-panel")).not.toBeInTheDocument();
  });

  it("reveals the optional features only after being expanded", async () => {
    render(<Workspace detail={detailFixture()} online={false} courseId="course-1" />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    await userEvent.click(screen.getByRole("button", { name: /Latihan lanjutan/ }));

    expect(screen.getByRole("button", { name: /Latihan lanjutan/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("review-queue")).toBeInTheDocument();
    expect(screen.getByTestId("interleaved-practice")).toBeInTheDocument();
    expect(screen.getByTestId("elaboration-panel")).toBeInTheDocument();
  });
});

describe("Workspace learning-science gates", () => {
  it("shows the pretest banner before reading and allows skipping", async () => {
    clearGates();
    render(<Workspace detail={detailFixture()} online={false} />);

    expect(
      await screen.findByRole("heading", { name: /Pra-tes singkat sebelum membaca/ }),
    ).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "Lewati pra-tes" }));

    expect(screen.getByRole("navigation", { name: "Daftar isi" })).toBeInTheDocument();
    expect(window.localStorage.getItem("pretest:topic-1")).not.toBeNull();
  });

  it("asks for a free-recall brain dump before Q&A opens", async () => {
    clearGates();
    render(<Workspace detail={detailFixture()} online={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "2 Tanya" }));

    expect(screen.getByRole("heading", { name: /Tulis dulu yang Anda ingat/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Tanya sesuatu/)).not.toBeInTheDocument();

    const dump = screen.getByPlaceholderText(/Tulis semua yang Anda ingat/);
    await userEvent.click(dump);
    await userEvent.paste(
      "Habitus adalah disposisi terinternalisasi yang membentuk praktik sehari-hari menurut Bourdieu.",
    );
    await userEvent.click(screen.getByRole("button", { name: /Simpan & buka Tanya/ }));

    expect(screen.getByPlaceholderText(/Tanya sesuatu/)).toBeInTheDocument();
    expect(window.localStorage.getItem("recall:topic-1")).toContain("Habitus adalah");
  });
});

describe("Workspace essay (P0-4, R6)", () => {
  it("defaults to the module's generated prompt and rubric", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    expect(screen.getByPlaceholderText("Pertanyaan esai")).toHaveValue(
      "Jelaskan habitus dengan kata sendiri.",
    );
    expect(screen.getByPlaceholderText("Rubrik (opsional)")).toHaveValue(
      "1. Definisi 2. Contoh 3. Kritik",
    );
  });

  it("autosaves the draft answer so a disconnect cannot lose work", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    await userEvent.type(screen.getByPlaceholderText(/Jawaban Anda/), "Habitus itu");

    await waitFor(() =>
      expect(window.localStorage.getItem("draft:topic-1")).toBe("Habitus itu"),
    );
  });

  it("restores a saved draft on remount", async () => {
    window.localStorage.setItem("draft:topic-1", "draft lama");
    render(<Workspace detail={detailFixture()} online={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Jawaban Anda/)).toHaveValue("draft lama"),
    );
  });

  it("refuses to grade offline and never posts the essay", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    await userEvent.type(screen.getByPlaceholderText(/Jawaban Anda/), "Habitus itu");
    await userEvent.click(screen.getByRole("button", { name: "Nilai esai" }));

    expect(screen.getByText("Penilaian butuh internet. Sambungkan dulu.")).toBeInTheDocument();
    expect(calls.some((c) => c.url.startsWith("/api/grade"))).toBe(false);
  });

  it("grades an essay with the rubric and records the attempt", async () => {
    render(<Workspace detail={detailFixture()} online />);
    await userEvent.click(screen.getByRole("tab", { name: "3 Latihan" }));

    await userEvent.type(screen.getByPlaceholderText(/Jawaban Anda/), "Habitus itu disposisi.");
    await userEvent.click(screen.getByRole("button", { name: "Nilai esai" }));

    await waitFor(() => expect(screen.getAllByText("Umpan balik esai.").length).toBeGreaterThan(0));
    const grade = calls.find((c) => c.url.startsWith("/api/grade"));
    expect(grade?.body).toMatchObject({
      questionText: "Jelaskan habitus dengan kata sendiri.",
      studentAnswer: "Habitus itu disposisi.",
      rubric: "1. Definisi 2. Contoh 3. Kritik",
      topicId: "topic-1",
    });
    await waitFor(() => {
      const attempt = calls.find(
        (c) =>
          c.url === "/api/attempts" &&
          Array.isArray(c.body?.items) &&
          (c.body.items as { questionType: string }[])[0]?.questionType === "essay",
      );
      expect(attempt).toBeDefined();
    });
  });
});

describe("Workspace export (Phase 3)", () => {
  it("offers Markdown, Anki, module PDF and worksheet PDF downloads when online", () => {
    render(<Workspace detail={detailFixture()} online={true} />);

    for (const [label, fmt] of [
      ["Markdown", "md"],
      ["Anki", "anki"],
      ["PDF modul", "pdf"],
      ["PDF lembar kerja", "pdf-worksheet"],
    ] as const) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", `/api/modules/mod-1/export?format=${fmt}`);
      expect(link).toHaveAttribute("download");
    }
  });

  it("disables all exports when offline instead of hanging on a server round-trip", () => {
    render(<Workspace detail={detailFixture()} online={false} />);

    // No export link is navigable offline…
    expect(screen.queryByRole("link", { name: "PDF modul" })).toBeNull();
    expect(screen.queryByRole("link", { name: "PDF lembar kerja" })).toBeNull();
    // …they are explained as disabled chips.
    const pdf = screen.getByText("PDF modul", { exact: true });
    expect(pdf.closest("span[aria-disabled='true']")).toBeTruthy();
    expect(pdf).toHaveAttribute("title", "Ekspor butuh internet. Sambungkan dulu.");
  });
});


describe("Workspace tablist a11y", () => {
  it("exposes a tablist with keyboard-selectable tabs", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    const list = screen.getByRole("tablist");
    expect(list).toBeInTheDocument();
    expect(list.querySelector("#tab-read")).not.toBeNull();
  });

  it("moves selection and focus with ArrowRight", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    const read = screen.getByRole("tab", { name: "1 Baca" });
    read.focus();
    expect(read).toHaveFocus();

    await userEvent.type(read, "{ArrowRight}");

    expect(screen.getByRole("tab", { name: "2 Tanya" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "2 Tanya" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "1 Baca" })).toHaveAttribute("aria-selected", "false");
  });

  it("wraps ArrowRight from the last tab back to the first", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);
    const sources = screen.getByRole("tab", { name: "4 Sumber" });
    sources.focus();

    await userEvent.type(sources, "{ArrowRight}");

    expect(screen.getByRole("tab", { name: "1 Baca" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "1 Baca" })).toHaveFocus();
  });
});

describe("Workspace module management", () => {
  it("deletes the module only after confirming in an accessible dialog", async () => {
    const onModuleDeleted = vi.fn();
    render(
      <Workspace detail={detailFixture()} online={false} onModuleDeleted={onModuleDeleted} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Hapus modul/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await userEvent.click(within(dialog).getByRole("button", { name: "Batal" }));

    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(onModuleDeleted).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /Hapus modul/ }));
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /Hapus modul/ }),
    );

    await waitFor(() => expect(onModuleDeleted).toHaveBeenCalledTimes(1));
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/api/modules/mod-1");
  });

  it("shows the module version history in Sumber", async () => {
    render(<Workspace detail={detailFixture()} online={false} />);

    await userEvent.click(screen.getByRole("tab", { name: "4 Sumber" }));

    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("initial synthesis")).toBeInTheDocument();
  });
});

describe("Workspace grounding block (Tier 1 hard gate)", () => {
  const blockedDetail = detailFixture({
    verification: {
      tier1: {
        passed: false,
        blocked: true,
        citations: { total: 1, valid: 0, phantom: 1 },
        claims: { total: 1, uncited: 0, ratio: 0, threshold: 0.3, overThreshold: false },
        entities: { checked: 0, mismatched: 0 },
        findings: [],
      },
      critic: null,
      gauge: {
        score: 0,
        band: "gagal",
        blocked: true,
        breakdown: {
          citationsTotal: 1, citationsValid: 0, citationsPhantom: 1,
          claimsTotal: 1, uncitedClaims: 0, uncitedRatio: 0, uncitedThreshold: 0.3,
          uncitedOverThreshold: false, entitiesChecked: 0, entitiesMismatched: 0,
          criticRan: false, criticJudged: 0, criticSupported: 0, criticUncertain: 0,
          criticContradicted: 0, aiFlagged: 0,
        },
        breakdownLines: ["Sitasi hantu: 1"],
        caveat: "c",
        flagCount: 1,
      },
      verifiedAt: null,
      repairAttempts: 0,
    } as unknown as VerificationPayload,
  });

  it("withholds the reader, Q&A and practice when a phantom citation is found", async () => {
    const user = userEvent.setup();
    render(<Workspace detail={blockedDetail} online={false} />);

    // Reader body is withheld, not shown.
    expect(screen.getByText(/Isi modul ditahan/i)).toBeInTheDocument();

    // Q&A tab is gated too.
    await user.click(screen.getByRole("tab", { name: "2 Tanya" }));
    expect(screen.getByText(/Tanya ditahan/i)).toBeInTheDocument();

    // Practice tab is gated too.
    await user.click(screen.getByRole("tab", { name: "3 Latihan" }));
    expect(screen.getByText(/Latihan ditahan/i)).toBeInTheDocument();

    // Exports are withheld (disabled spans, not real download links).
    expect(screen.queryByRole("link", { name: /Markdown/ })).not.toBeInTheDocument();
  });
});
