import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

/**
 * GAP 1 regression: retrieval takes ~10s and used to change NOTHING on screen
 * while it ran (the only feedback was an `sr-only` live region), so the app read
 * as frozen. The loading state must be on screen while the request is still in
 * flight — asserted here against a retrieve call that never resolves.
 */
describe("Home retrieval loading state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a visible loading panel the moment a topic is submitted", async () => {
    const courses = [{ id: "c1", name: "Antropologi", major: null, modules: [], topics: [] }];
    // `/api/retrieve` hangs for the whole test: the UI must not wait for it to
    // give the student feedback.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/api/retrieve")) {
          return new Promise(() => {}) as never; // never settles
        }
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
      }),
    );

    render(<Home />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "+ Topik" }));
    await user.type(
      await screen.findByPlaceholderText(/Teori Pertukaran Simbolik/i),
      "Tingkatan Aktor dan Level Hukum",
    );
    await user.click(screen.getByRole("button", { name: /^Sintesis$/i }));

    // Immediate, VISIBLE feedback (not just the sr-only live region): the panel
    // heading, the first staged label and the skeleton shape of what is coming.
    const panel = await screen.findByRole("status", { busy: true });
    // The heading and the staged label live INSIDE the visible panel — the
    // pre-existing `sr-only` live region announces the same thing to screen
    // readers, which is exactly why the old build looked frozen to everyone else.
    expect(within(panel).getByRole("heading", { name: /Mencari paper untuk topik ini/i })).toBeInTheDocument();
    expect(within(panel).getByText("Mencari paper…")).toBeInTheDocument();
    expect(panel.className).not.toContain("sr-only");
  });
});
