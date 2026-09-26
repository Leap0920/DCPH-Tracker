import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// Ends with a path separator on both POSIX and Windows.
const projectRoot = fileURLToPath(new URL("./", import.meta.url))

// Next.js auto-loads .env.local; vitest does not. Some test-imported modules
// (e.g. lib/env via utils/supabase/server) throw at import time when Supabase
// vars are missing, so surface the same vars vitest-side (names/values mirror
// Next's own dotenv handling; absent file = no env, tests must not rely on it).
function loadEnvLocal(): Record<string, string> {
  const env: Record<string, string> = {}
  try {
    const raw = fs.readFileSync(path.join(projectRoot, ".env.local"), "utf8")
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match) continue
      env[match[1]] = match[2].replace(/^["']|["']$/g, "")
    }
  } catch {
    // No .env.local — leave env empty.
  }
  return env
}

export default defineConfig({
  resolve: {
    // Mirrors tsconfig paths: "@/*" -> "./*"
    // Regex `find` keeps Windows paths clean (no "C:\repo\" + "/lib/x").
    alias: [
      { find: /^@\//, replacement: projectRoot },
      // Next.js aliases "server-only" at bundle time; vitest (plain node)
      // cannot resolve the package, so point it at a no-op stub.
      {
        find: /^server-only$/,
        replacement: path.join(projectRoot, "vitest.server-only-stub.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**"],
    env: loadEnvLocal(),
  },
})