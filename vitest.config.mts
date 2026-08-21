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

export default defineConfig({
  test: {
    projects: [
      {
        resolve,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "app/**/*.test.ts"],
        },
      },
      {
        resolve,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["app/**/*.dom.test.tsx"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
