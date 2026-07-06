import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineWorkspace } from "vitest/config";

// Pin both projects to the repository root so their include globs resolve the same way no matter
// which directory vitest is launched from (the frontend `test` script runs it from ./frontend).
const root = dirname(fileURLToPath(import.meta.url));

// Two test projects with different environments: the engine/server suite runs under Node, and
// the editor frontend runs under jsdom so hooks and components can be exercised with a DOM.
export default defineWorkspace([
  {
    root,
    test: {
      name: "engine",
      environment: "node",
      include: ["test/**/*.test.ts"],
    },
  },
  {
    root,
    // esbuild's automatic JSX runtime lets .tsx component tests compile without a Babel/React plugin.
    esbuild: { jsx: "automatic" },
    // The frontend and root node_modules hold separate yjs copies; the app resolves every bare
    // `yjs` import to one copy via its Vite root, so tests that build a Y.Doc alongside shared/collab
    // must do the same or the two instances' constructor checks reject each other's types.
    resolve: { dedupe: ["yjs"] },
    test: {
      name: "frontend",
      environment: "jsdom",
      include: ["frontend/src/**/*.test.{ts,tsx}"],
    },
  },
]);
