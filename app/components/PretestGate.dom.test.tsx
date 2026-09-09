import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PretestGate, { hasTakenPretest, pretestKey } from "./PretestGate";
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

const ITEM: QuestionBankItem = {
  id: "q1",
  topicId: "t1",
  moduleId: "m1",
  stem: "Prequestion satu",
  options: ["A", "B"],
  answer: "A",
  explanation: "e",
  author: "student",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  installFetch([ITEM]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PretestGate localStorage gate", () => {
  it("shows the prequestions on first visit, then marks done in localStorage", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    expect(hasTakenPretest("t1")).toBe(false);

    render(<PretestGate topicId="t1" onDone={onDone} />);

    expect(await screen.findByText(/Prequestion satu/)).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /Lewati pra-tes/ })[0]);

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(pretestKey("t1"))).not.toBeNull();
    expect(hasTakenPretest("t1")).toBe(true);
  });
});
