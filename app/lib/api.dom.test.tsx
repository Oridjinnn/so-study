// Runs under the `dom` project (jsdom) because apiFetch touches window.location.
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, __resetApiFetchRedirect, ApiError } from "./api";

type MockRes = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

// jsdom's `window.location.assign` is non-configurable, so we can't spy on it
// directly. Stub the whole `location` object with a spy instead, preserving the
// path/search apiFetch reads to build the `?next=` target.
let realLocation: Location | undefined;
function stubLocation(): { assign: ReturnType<typeof vi.fn> } {
  realLocation = window.location;
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: realLocation.pathname,
      search: realLocation.search,
      assign,
    },
  });
  return { assign };
}
function restoreLocation() {
  if (realLocation) {
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    realLocation = undefined;
  }
}

function mockFetch(res: MockRes) {
  const fn = vi.fn(async () => res);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  restoreLocation();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetApiFetchRedirect();
});

describe("apiFetch", () => {
  it("returns the response unchanged on success", async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({}) });
    const out = await apiFetch("/api/courses");
    expect(out.status).toBe(200);
    expect(out.ok).toBe(true);
  });

  it("throws a typed ApiError on 401 but still surfaces a message", async () => {
    mockFetch({ ok: false, status: 401, json: async () => ({ error: "nope" }) });
    stubLocation();
    await expect(apiFetch("/api/courses")).rejects.toBeInstanceOf(ApiError);
  });

  it("redirects to /login?next=<current path> on a single 401", async () => {
    const fetchFn = mockFetch({ ok: false, status: 401, json: async () => ({}) });
    const { assign } = stubLocation();
    await apiFetch("/api/courses").catch(() => {});
    const next = `${window.location.pathname}${window.location.search}`;
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(next)}`);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("redirects exactly ONCE when many requests 401 together (no storm)", async () => {
    const fetchFn = mockFetch({ ok: false, status: 401, json: async () => ({}) });
    const { assign } = stubLocation();
    // A lapsed session fans out several in-flight requests at once.
    const urls = ["/api/a", "/api/b", "/api/c", "/api/d", "/api/e"];
    const results = await Promise.allSettled(urls.map((u) => apiFetch(u)));
    // Every call still rejects with the typed error so callers' catches run.
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    // But the browser is only asked to navigate once.
    expect(assign).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(urls.length);
  });

  it("does NOT redirect on 503 (server misconfig) and surfaces it as an error", async () => {
    mockFetch({ ok: false, status: 503, json: async () => ({ error: "secret missing" }) });
    const { assign } = stubLocation();
    const res = await apiFetch("/api/courses");
    // Handed back untouched so the call site's normal `!res.ok` path shows it.
    expect(res.status).toBe(503);
    expect(assign).not.toHaveBeenCalled();
  });
});
