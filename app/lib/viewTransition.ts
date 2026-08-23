/**
 * Screen-to-screen transitions with zero dependencies.
 *
 * Deliberately NOT framer-motion: this is a single-user app whose target device
 * is an iPad, it installs as a PWA and must stay small (see the PWA/offline
 * work), and an animation library is real bundle weight for what the platform
 * already does natively. The View Transitions API is built into Safari 18 and
 * Chrome, cross-fades the changed pixels for free, and degrades to "just swap
 * the DOM" everywhere else.
 *
 * Contract: `withViewTransition(update)` ALWAYS applies `update`, exactly once.
 * A missing API, a `prefers-reduced-motion` preference, or a browser that throws
 * mid-call must never cost the student the state change they asked for — the
 * transition is decoration, the update is the feature.
 */

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished?: Promise<unknown> };
};

/** True when the browser supports the View Transitions API. */
export function supportsViewTransitions(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof (document as ViewTransitionDocument).startViewTransition === "function"
  );
}

/** True when the user asked the OS for reduced motion; we then skip animation. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Runs `update` inside a native view transition when that is available and
 * wanted, and plainly otherwise. Returns nothing: callers must not depend on the
 * transition having happened, only on the update having been applied.
 */
export function withViewTransition(update: () => void): void {
  if (!supportsViewTransitions() || prefersReducedMotion()) {
    update();
    return;
  }
  const doc = document as ViewTransitionDocument;
  try {
    // Per spec the update callback is invoked exactly once (asynchronously, once
    // the old state is captured), so we must NOT also call `update` ourselves on
    // this path — a double call would flip a toggle twice.
    doc.startViewTransition!(update);
  } catch {
    update();
  }
}
