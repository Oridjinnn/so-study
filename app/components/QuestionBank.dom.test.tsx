import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import QuestionBank from "./QuestionBank";
import type { QuestionBankItem } from "../lib/types";

function installFetch(items: QuestionBankItem[]): void {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    let data: Record<string, unknown> = { ok: true };
    if (url.startsWith("/api/questions")) data = { items };
    return { ok: true, status: 200, json: async () => data } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
}

const STUDENT: QuestionBankItem = {
  id: "qs",
  topicId: "t1",
  moduleId: "m1",
  stem: "Soal buatan saya",
  options: ["A", "B"],
  answer: "A",
  explanation: null,
  author: "student",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const AI: QuestionBankItem = {
  id: "qa",
  topicId: "t1",
  moduleId: "m1",
  stem: "Soal dari AI",
  options: ["C", "D"],
  answer: "C",
  explanation: null,
  author: "ai",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

beforeEach(() => {
  installFetch([STUDENT, AI]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("QuestionBank", () => {
  it("renders both AI-authored and student-authored items", async () => {
    render(<QuestionBank topicId="t1" moduleId="m1" />);

    expect(await screen.findByText("Soal buatan saya")).toBeInTheDocument();
    expect(screen.getByText("Soal dari AI")).toBeInTheDocument();
    expect(screen.getByText(/^Saya \(1\)$/)).toBeInTheDocument();
    expect(screen.getByText(/^AI \(1\)$/)).toBeInTheDocument();
  });
});
