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

// Both projects resolve modules the same way, so the resolver is declared once.
const alias = [
  // Mirrors tsconfig paths: "@/*" -> "./*"
  // Regex `find` keeps Windows paths clean (no "C:\repo\" + "/lib/x").
  { find: /^@\//, replacement: projectRoot },
  // Next.js aliases "server-only" at bundle time; vitest (plain node)
  // cannot resolve the package, so point it at a no-op stub.
  {
    find: /^server-only$/,
    replacement: path.join(projectRoot, "vitest.server-only-stub.ts"),
  },
]

export default defineConfig({
  test: {
    // Two projects, one suite (plan 5, D4). The node project is the suite as it
    // was before the split and must not change behaviour: same environment, same
    // globals, same env. The jsdom project exists only for component tests,
    // which need a DOM and a JSX transform vitest does not get for free.
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          globals: false,
          include: ["**/*.test.ts"],
          exclude: [
            "**/node_modules/**",
            "**/.next/**",
            "**/dist/**",
            "**/coverage/**",
            // `components/**` belongs to the jsdom project. A `.test.ts` there
            // would otherwise match both includes and run in both projects.
            "components/**",
          ],
          env: loadEnvLocal(),
        },
      },
      {
        // tsconfig's `"jsx": "preserve"` is right for Next's compiler and wrong
        // for esbuild, which would hand the `.tsx` source through untransformed.
        // The automatic runtime is the lightest fix; no React plugin needed.
        esbuild: { jsx: "automatic" },
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          globals: false,
          include: ["components/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/coverage/**"],
          setupFiles: ["./vitest.setup.dom.ts"],
          // Deliberately no `env: loadEnvLocal()`: a component test must not
          // read a secret or reach a socket, and leaving .env.local out makes a
          // component that transitively imports lib/env fail loudly instead.
        },
      },
    ],
  },
})
