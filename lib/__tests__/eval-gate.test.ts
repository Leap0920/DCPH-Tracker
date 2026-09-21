import { existsSync, readFileSync, statSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * The guard for `npm run test:eval` (Plan 6, Task 1).
 *
 * The CI step "Eval gate (recall)" runs that script, and the script names its
 * files by path. Renaming or deleting an eval file would therefore leave the
 * step running nothing and still passing, which is the failure this test makes
 * impossible: the paths the script names have to be the two golden evals, and
 * every path it names has to exist on disk.
 *
 * The URL form, not `process.cwd()`: vitest runs from the repo root today, but
 * the URL cannot drift with the runner's working directory.
 */

const packageUrl = new URL("../../package.json", import.meta.url)

const manifest = JSON.parse(readFileSync(packageUrl, "utf8")) as {
  scripts?: Record<string, string>
}

const testEval = manifest.scripts?.["test:eval"] ?? ""

/** Every path the script hands to the runner, in the order it names them. */
const namedPaths = testEval.match(/\S+\.test\.ts\b/g) ?? []

/** A repo-relative path resolved against this test file, so a run from any cwd
 *  resolves the same file. */
function repoFile(relative: string): URL {
  return new URL(`../../${relative}`, import.meta.url)
}

describe("the named eval gate", () => {
  it("has a test:eval script that runs the two golden evals", () => {
    expect(testEval).toContain("vitest run")
    expect(testEval).toContain("lib/__tests__/retrieval-eval.test.ts")
    expect(testEval).toContain("lib/__tests__/pipeline-eval.test.ts")
  })

  it("names only files that exist, so the step cannot run nothing", () => {
    // A renamed eval file fails here by name instead of turning the CI step
    // into a green no-op: the filter would match no file and vitest would
    // report no failures.
    expect(namedPaths.length).toBeGreaterThan(0)

    const missing = namedPaths.filter((path) => {
      const url = repoFile(path)
      return !existsSync(url) || !statSync(url).isFile()
    })

    expect(missing, JSON.stringify(missing)).toEqual([])
  })

  it("narrows the suite rather than replacing it", () => {
    // Constraint 6: the full suite still runs both eval files with their own
    // `RECALL_GATE` assertions, so `test` stays the plain full run.
    expect(manifest.scripts?.test).toBe("vitest run")
  })

  it("keeps the workflow step that runs it", () => {
    // Without this, deleting the CI step leaves every other test green and the
    // gate invisible again, which is the erosion the step exists to prevent.
    const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8")

    expect(workflow).toContain("Eval gate (recall)")
    expect(workflow).toContain("npm run test:eval")
  })
})
