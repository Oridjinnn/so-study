// jsdom setup for the component/DOM project (see vitest.config.ts).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements no layout engine, so these never exist. The components call
// them for iPad reading ergonomics (cite jump, TOC jump, print-to-PDF); tests
// that care spy on them, the rest just must not crash.
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (typeof window !== "undefined") {
  window.print = function print() {};
}

// React Testing Library only auto-cleans with `globals: true`; we keep globals
// off (explicit vitest imports, like the node tests) and unmount by hand.
afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") window.localStorage.clear();
});
