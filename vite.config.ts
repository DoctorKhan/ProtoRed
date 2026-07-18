import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  // Relative base so the static build works under any path, including a GitHub
  // Pages project site (user.github.io/<repo>/) without hardcoding the repo name.
  base: "./",
  server: { port: 5173 },
  build: { outDir: "../dist", emptyOutDir: true },
});
