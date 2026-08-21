import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewQueue from "./ReviewQueue";
import type { AssessmentAttempt } from "../lib/types";

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

function installFetch(attempts: AssessmentAttempt[]): Call[] {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    let data: Record<string, unknown> = { ok: true };
    if (url.startsWith("/api/attempts")) data = { items: undefined, attempts };
    return { ok: true, status: 200, json: async () => data } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const DUE: AssessmentAttempt = {
  id: "att1",
  moduleId: "m1",
  topicId: "t1",
  questionType: "mcq",
  itemRef: "q1",
  prompt: "Apa itu habitus?",
  response: null,
  score: null,
  isCorrect: false,
  confidence: null,
  answeredAt: "2026-01-01T00:00:00.000Z",
  intervalDays: 10,
  repetitions: 2,
  easeFactor: 2.5,
  stability: 5,
  difficulty: 5,
  scheduledNextAt: "2026-02-01T00:00:00.000Z",
};

let calls: Call[];

beforeEach(() => {
  calls = installFetch([DUE]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReviewQueue", () => {
  it("renders queued items and grades them with the CURRENT outcome", async () => {
    const user = userEvent.setup();
    const onGraded = vi.fn();
    render(<ReviewQueue moduleId="m1" topicId="t1" onGraded={onGraded} />);

    expect(await screen.findByText("Apa itu habitus?")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /Lagi/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sulit/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Bagus/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mudah/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Bagus/ }));
    await user.click(screen.getByRole("button", { name: /Tandai sudah dipraktik/ }));

    await waitFor(() => {
      const post = calls.find((c) => c.url.startsWith("/api/attempts") && c.method === "POST");
      expect(post).toBeDefined();
      const items = (post!.body!.items as { isCorrect: boolean }[])[0];
      expect(items.isCorrect).toBe(true);
    });
    expect(onGraded).toHaveBeenCalled();
  });
});
