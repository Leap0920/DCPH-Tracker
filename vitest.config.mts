import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Ends with a path separator on both POSIX and Windows.
const projectRoot = fileURLToPath(new URL("./", import.meta.url))

export default defineConfig({
  resolve: {
    // Mirrors tsconfig paths: "@/*" -> "./*"
    // Regex `find` keeps Windows paths clean (no "C:\repo\" + "/lib/x").
    alias: [{ find: /^@\//, replacement: projectRoot }],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**"],
  },
})