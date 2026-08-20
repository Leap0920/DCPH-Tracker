// Flat config for ESLint 9 + eslint-config-next 15.1.6.
//
// eslint-config-next 15.1.6 ships eslintrc-format configs only, so it must be
// bridged with FlatCompat (this is the pattern create-next-app generates).
// Deliberately avoids `defineConfig`/`globalIgnores` from "eslint/config":
// that entry point only exists in ESLint >= 9.24, and this project declares
// eslint ^9.18.0.
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { FlatCompat } from "@eslint/eslintrc"

const __dirname = dirname(fileURLToPath(import.meta.url))

const compat = new FlatCompat({ baseDirectory: __dirname })

export default [
  // Global ignores (an `ignores`-only object applies to the whole run).
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "dist/**",
      "next-env.d.ts",
      "**/*.tsbuildinfo",
    ],
  },

  ...compat.extends("next/core-web-vitals"),

  // `eslint .` only auto-discovers .js/.cjs/.mjs unless some config object
  // names other extensions. This makes the TS/TSX sources lintable without
  // relying on the extension list inside eslint-config-next's overrides.
  // .mts/.cts are intentionally omitted: they are only parsed correctly if
  // eslint-config-next's TS override claims them, and forcing them in here
  // could hand vitest.config.mts to a non-TypeScript parser.
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    rules: {},
  },
]