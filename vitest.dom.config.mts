import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// DOM-level suites (React components rendered into a real document). Kept
// separate from vitest.config.mts because the pure-logic suites there run in
// the `node` environment and must stay dependency-free — jsdom is a dev-only
// install for these.
const projectRoot = fileURLToPath(new URL("./", import.meta.url))

export default defineConfig({
  // The repo's tsconfig uses the automatic JSX runtime; mirror it so .tsx
  // suites transform without needing a React import in scope.
  esbuild: { jsx: "automatic" },
  resolve: {
    // Mirrors tsconfig paths: "@/*" -> "./*" (regex keeps Windows paths clean).
    alias: [
      { find: /^@\//, replacement: projectRoot },
      {
        find: /^server-only$/,
        replacement: path.join(projectRoot, "vitest.server-only-stub.ts"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["components/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**"],
  },
})
