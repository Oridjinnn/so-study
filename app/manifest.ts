import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest, NOT /manifest — Next normalizes the
// `app/manifest.ts` metadata route by appending `.webmanifest`
// (node_modules/next/dist/lib/metadata/get-metadata-route.js:141). That is
// exactly the URL `metadata.manifest` in app/layout.tsx points at, which is why
// this stays a generated route instead of a hand-written public/ file: one
// source of truth, type-checked against MetadataRoute.Manifest, and no chance of
// the public file and the <link rel="manifest"> drifting apart.
//
// This exists for ONE thing: making "Add to Home Screen" on the student's iPad
// produce a real standalone app instead of a Safari bookmark. Without a
// reachable, parseable manifest, iOS silently degrades to a bookmark that opens
// in Safari with the address bar — the exact failure this file fixes.
export default function manifest(): MetadataRoute.Manifest {
  return {
    // `id` pins the app identity so a later start_url change does not make iOS /
    // Chromium treat it as a *different* installed app (which would orphan the
    // home-screen icon). Kept equal to start_url so it never has to change.
    id: "/",
    name: "So-study — head-start pra-kuliah",
    // iPad truncates home-screen labels around ~12 characters; "So-study" fits
    // whole, so the icon never reads as "So-stu…".
    short_name: "So-study",
    description:
      "Kit belajar pra-kuliah: baca modul dari paper, tanya terjaga, dan latih diri sebelum kuliah.",
    // start_url and scope both stay at the root because an unauthenticated
    // standalone launch is redirected to /login: /login must be INSIDE scope, or
    // iOS treats it as an out-of-scope navigation and kicks the student out to
    // Safari on the very first launch.
    start_url: "/",
    scope: "/",
    display: "standalone",
    // The student reads long modules in portrait and types essays in landscape,
    // so never lock the orientation.
    orientation: "any",
    lang: "id",
    // Must stay in sync with `viewport.themeColor` in app/layout.tsx — iOS reads
    // the meta tag, Chromium prefers the manifest, and a mismatch shows up as a
    // colour flicker in the standalone status bar.
    theme_color: "#4f46e5",
    background_color: "#0b0b0f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Separate maskable entry (never combined with "any" in one entry): a
      // maskable icon has ~10% safe-zone padding, so reusing it as the plain
      // icon would render visibly shrunken on iOS.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      // iOS picks the home-screen icon from <link rel="apple-touch-icon"> (see
      // app/layout.tsx), but listing the same 180x180 file here keeps the
      // manifest self-sufficient for any other installer.
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
