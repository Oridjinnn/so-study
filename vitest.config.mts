import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Two test environments, one command (`npm test` / scripts/ci.sh):
//   - `node` — pure logic in src/lib and app/lib (scoring, scheduler, guards,
//     export formatters). No DOM, so it stays fast.
//   - `dom`  — component/DOM tests (`*.dom.test.tsx`) rendered in jsdom with
//     @testing-library/react. Closes ROADMAP §7.6 P2-15.
// The `@/...` alias mirrors tsconfig paths so components under test resolve
// their imports exactly as they do in the Next.js build.

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const resolve = { alias: { "@": rootDir } };

// Session signing key for the tests. src/lib/auth.ts FAILS CLOSED without one
// (that is the point), so the test environment must supply a value — it is a
// fixed literal, never a real secret, and every test that cares about the
// missing-secret path deletes it explicitly.
const env = { SESSION_SECRET: "test-session-secret-do-not-use-in-production" };

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "app/**/*.test.ts"],
          env,
        },
      },
      {
        resolve,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["app/**/*.dom.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
          // jsdom + @testing-library/user-event (real timers) is slow on the
          // first test of a file and under parallel load; the 5s default flakes
          // on healthy tests. 15s is a floor, not a licence to hang.
          testTimeout: 15000,
          hookTimeout: 15000,
          env,
        },
      },
    ],
  },
});
