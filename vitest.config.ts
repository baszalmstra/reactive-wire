import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Test discovery lives in the workspace projects (engine/node and frontend/jsdom); it is
    // referenced by an absolute path so `--config vitest.config.ts` resolves the same workspace
    // no matter which directory vitest is launched from.
    workspace: resolve(here, "vitest.workspace.ts"),
    exclude: ["**/node_modules/**", "**/dist/**", "**/.{idea,git,cache,output,temp}/**", "e2e/**", "test-results/**"],
  },
});
