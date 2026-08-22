import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AccountBar from "./AccountBar";
import { __resetApiFetchRedirect } from "../lib/api";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function mockFetch(handler: (url: string) => { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const fn = vi.fn<FetchLike>(async (input) => handler(String(input)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

// jsdom's `window.location.assign` is non-configurable, so we can't spy on it
// directly. Stub the whole `location` object with a spy instead.
let realLocation: Location | undefined;
function stubLocation(): { assign: ReturnType<typeof vi.fn> } {
  realLocation = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname: realLocation.pathname, search: realLocation.search, assign },
  });
  return { assign };
}
function restoreLocation() {
  if (realLocation) {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    realLocation = undefined;
  }
}

afterEach(() => {
  restoreLocation();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetApiFetchRedirect();
});

describe("AccountBar", () => {
  it("renders the signed-in identity fetched from /api/auth/session", async () => {
    mockFetch((url) =>
      url.includes("/api/auth/session")
        ? { ok: true, status: 200, json: async () => ({ user: { id: "u1", name: "budi", displayName: "Budi" } }) }
        : { ok: true, status: 200, json: async () => ({}) },
    );

    render(<AccountBar />);

    // Display name comes from the client fetch, not server HTML (shared shell).
    expect(await screen.findByText("Budi")).toBeInTheDocument();
    // The sign-out affordance is present.
    expect(screen.getByRole("button", { name: /Keluar/ })).toBeInTheDocument();
  });

  it('Keluar POSTs /api/auth/logout and hard-navigates to "/login"', async () => {
    const fetchFn = mockFetch((url) => {
      if (url.includes("/api/auth/session"))
        return { ok: true, status: 200, json: async () => ({ user: { id: "u1", name: "budi", displayName: "Budi" } }) };
      if (url.includes("/api/auth/logout"))
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const { assign } = stubLocation();
    const user = userEvent.setup();

    render(<AccountBar />);
    const logout = await screen.findByRole("button", { name: /Keluar/ });

    await user.click(logout);

    // The logout POST actually happened.
    const logoutCall = fetchFn.mock.calls.find(([url]) => String(url).includes("/api/auth/logout"));
    expect(logoutCall).toBeDefined();
    expect(logoutCall?.[1]).toMatchObject({ method: "POST" });

    // And we hard-navigate back to /login (proxy re-runs the auth gate).
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
  });
});
