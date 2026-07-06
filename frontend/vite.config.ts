import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The frontend and root node_modules hold separate yjs copies; force every bare `yjs` import to
  // one copy so a Y.Doc created in the editor and a shared/collab helper share yjs's constructor
  // identity (a mismatch throws "Unexpected content type" when the doc crosses the boundary).
  resolve: { dedupe: ["yjs"] },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          collab: ["yjs"],
          reactflow: ["@xyflow/react"],
        },
      },
    },
  },
});
