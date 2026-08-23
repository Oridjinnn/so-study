import { describe, expect, it, vi, afterEach } from "vitest";
import {
  prefersReducedMotion,
  supportsViewTransitions,
  withViewTransition,
} from "./viewTransition";

/**
 * GAP 3: screen transitions must be free polish, never a dependency and never a
 * risk. The contract under test is narrow and absolute: the update runs EXACTLY
 * once, on every browser, in every motion preference, even if the API throws.
 */
function setStartViewTransition(impl: ((cb: () => void) => unknown) | undefined) {
  // Bypass the lib's stricter `Document.startViewTransition` signature: in jsdom
  // the property does not exist, and we only need to toggle a callable on/off.
  (document as unknown as { startViewTransition?: (cb: () => void) => unknown })
    .startViewTransition = impl;
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

afterEach(() => {
  setStartViewTransition(undefined);
  vi.unstubAllGlobals();
});

describe("withViewTransition", () => {
  it("applies the update directly when the API is absent (jsdom / older Safari)", () => {
    expect(supportsViewTransitions()).toBe(false);
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("routes the update through startViewTransition when supported", () => {
    const calls: string[] = [];
    setStartViewTransition((cb: () => void) => {
      calls.push("transition");
      cb();
      return { finished: Promise.resolve() };
    });
    expect(supportsViewTransitions()).toBe(true);

    const update = vi.fn(() => calls.push("update"));
    withViewTransition(update);

    expect(calls).toEqual(["transition", "update"]);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("skips the transition (but still updates) when the user asks for reduced motion", () => {
    const start = vi.fn((cb: () => void) => cb());
    setStartViewTransition(start);
    setReducedMotion(true);
    expect(prefersReducedMotion()).toBe(true);

    const update = vi.fn();
    withViewTransition(update);

    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain update when startViewTransition throws", () => {
    setStartViewTransition(() => {
      throw new Error("no active document");
    });
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("never applies the update twice (a toggle must not flip back)", () => {
    setStartViewTransition((cb: () => void) => {
      cb();
      return {};
    });
    let flag = false;
    withViewTransition(() => {
      flag = !flag;
    });
    expect(flag).toBe(true);
  });
});
