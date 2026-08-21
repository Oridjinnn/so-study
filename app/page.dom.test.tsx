import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "./page";

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function mockFetch(courses: unknown[]) {
  const fn = vi.fn<FetchLike>(async (url) => {
    if (typeof url === "string" && url.includes("/api/progress")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          topics: [],
          dueTodayCount: 0,
          dueTodayByCourse: {},
          streakDays: 0,
          heatmap: [],
          avgMastery: null,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ courses }) };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("Home first-run gating", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the Soso wizard (name screen first) for a fresh profile with zero courses", async () => {
    mockFetch([]);
    render(<Home />);

    // Screen 0 (name) greets a first-time user.
    expect(await screen.findByText(/Siapa namamu/i)).toBeInTheDocument();
    // No course exists, so the dashboard's empty-topic state must not show.
    expect(
      screen.queryByText(/Belum ada topik di mata kuliah ini/i),
    ).not.toBeInTheDocument();

    // Advancing past the name screen reveals the Soso welcome (Screen 1).
    await userEvent.setup().click(screen.getByRole("button", { name: /Lanjut/i }));
    expect(await screen.findByText(/Halo, aku Soso!/i)).toBeInTheDocument();
  });

  it("skips the wizard and shows the dashboard for a returning user", async () => {
    mockFetch([{ id: "c1", name: "Antropologi", major: null, modules: [], topics: [] }]);
    render(<Home />);

    // The dashboard's course view (empty of topics) is what greets them.
    expect(
      await screen.findByText(/Belum ada topik di mata kuliah ini/i),
    ).toBeInTheDocument();
    // The first-run wizard (name screen + Soso welcome) must never appear again.
    expect(screen.queryByText(/Siapa namamu/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Halo, aku Soso!/i)).not.toBeInTheDocument();
  });
});
