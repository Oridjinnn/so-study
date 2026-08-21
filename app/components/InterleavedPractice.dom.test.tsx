import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InterleavedPractice from "./InterleavedPractice";
import type { QuestionBankItem } from "../lib/types";

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

function installFetch(items: QuestionBankItem[]): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    let data: Record<string, unknown> = { ok: true };
    if (url.startsWith("/api/questions")) data = { items };
    else if (url.startsWith("/api/attempts")) data = { ok: true };
    return { ok: true, status: 200, json: async () => data } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const ITEMS: QuestionBankItem[] = [
  {
    id: "q1",
    topicId: "t1",
    moduleId: "m1",
    stem: "Stem satu",
    options: ["Opsi benar", "Opsi salah"],
    answer: "Opsi benar",
    explanation: "exp1",
    author: "student",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "q2",
    topicId: "t1",
    moduleId: "m1",
    stem: "Stem dua",
    options: ["Opsi benar", "Opsi salah"],
    answer: "Opsi benar",
    explanation: "exp2",
    author: "student",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
];

beforeEach(() => {
  installFetch(ITEMS);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InterleavedPractice regression (Wave-2 crash fix)", () => {
  it("answers the LAST question without throwing and shows the finished state", async () => {
    const user = userEvent.setup();
    render(<InterleavedPractice courseId="course-1" />);

    await screen.findByRole("button", { name: "Periksa jawaban" });

    for (let i = 0; i < ITEMS.length; i++) {
      await user.click(await screen.findByRole("radio", { name: "Opsi benar" }));
      await user.click(screen.getByRole("button", { name: "Periksa jawaban" }));
      await user.click(screen.getByRole("button", { name: /Bagus/ }));
      await user.click(screen.getByRole("button", { name: /Soal berikutnya|Selesai/ }));
    }

    await waitFor(() => expect(screen.getByText("Selesai!")).toBeInTheDocument());
  });

  it("renders the first practice question after loading", async () => {
    render(<InterleavedPractice courseId="course-1" />);
    expect(await screen.findByRole("heading", { name: "Latihan terinterleave" })).toBeInTheDocument();
    await screen.findByRole("button", { name: "Periksa jawaban" });
    expect(await screen.findByText(/Soal diacak dan dicampur/)).toBeInTheDocument();
  });
});
