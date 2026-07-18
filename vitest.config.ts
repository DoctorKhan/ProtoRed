import { defineConfig } from "vitest/config";

// Separate from vite.config.ts (which sets root: "client" for the browser build).
// Tests live at the repo root and import server/shared modules directly.
export default defineConfig({
  root: ".",
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
