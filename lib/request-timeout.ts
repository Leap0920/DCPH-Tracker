/**
 * Shared timeout budget for request-path Supabase/external reads.
 *
 * Mirrors the existing `withTimeout(3000)` pattern in
 * `app/api/health/route.ts` and the `AbortSignal.timeout` usage in
 * `lib/dcw.ts` / `lib/wiki.ts`. Supabase-js queries are thenables (not real
 * Promises), so this accepts PromiseLike and normalizes via Promise.resolve.
 */

export const REQUEST_TIMEOUT_MS = 2_000

export function withTimeout<T>(promise: PromiseLike<T>, ms: number = REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}