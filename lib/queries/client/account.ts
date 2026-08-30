/**
 * Browser-side fetchers for the two destructive account endpoints.
 *
 * Both go through API routes instead of calling Supabase directly — the
 * service-role work (purging the append-only watch log, deleting the GoTrue
 * user) cannot be done from a browser at all, and the routes re-check the
 * typed confirmation server-side.
 *
 * Kept out of the components so the components only own UI state: nothing here
 * touches React, and the response shapes are documented once.
 */

export interface ProgressResetResult {
  /** watch_status rows deleted — the entries the user could actually see. */
  tracked: number
  /**
   * watch_events rows deleted, or null when the server has no service-role key
   * and therefore left the activity log intact. Reported honestly in the UI.
   */
  eventsCleared: number | null
  /** Deleted content ids, whose community rating averages just moved. */
  contentIds: string[]
}

/** Reads `{ error }` off a failed response; falls back to a sane message. */
async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null)
  return typeof (data as { error?: unknown } | null)?.error === "string"
    ? ((data as { error: string }).error)
    : fallback
}

/**
 * Clears every tracked entry plus the activity log behind the rolling boards.
 *
 * @param confirm the phrase the user typed; the server rejects it unless it
 *   matches, so a caller cannot skip the gate by posting directly.
 */
export async function resetProgress(
  confirm: string
): Promise<ProgressResetResult> {
  const response = await fetch("/api/account/reset-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm }),
  })

  if (!response.ok) {
    throw new Error(
      await readError(response, "Could not reset your progress.")
    )
  }

  const payload = (await response.json().catch(() => null)) as {
    data?: Partial<ProgressResetResult>
  } | null

  return {
    tracked: payload?.data?.tracked ?? 0,
    eventsCleared: payload?.data?.eventsCleared ?? null,
    contentIds: payload?.data?.contentIds ?? [],
  }
}

/** Permanently deletes the signed-in account and everything attached to it. */
export async function deleteAccount(confirm: string): Promise<void> {
  const response = await fetch("/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm }),
  })

  if (!response.ok) {
    throw new Error(
      await readError(response, "Could not delete your account.")
    )
  }
}
