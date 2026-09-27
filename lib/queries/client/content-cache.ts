"use client"

import { useCallback, useEffect } from "react"
import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/queries/keys"

/**
 * The tracker caches all content entries in the browser for an hour, so an
 * admin edit used to stay invisible: navigating to /tracker served the
 * pre-edit rows until that cache went stale, and `revalidatePath` only clears
 * the server side. These helpers drop that cache the moment content changes.
 */

const CHANNEL = "dcph:content-changed"

/** react-query caches live per tab, so tell the other tabs too. */
function broadcastContentChanged() {
  if (typeof BroadcastChannel === "undefined") return
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage("changed")
  channel.close()
}

/**
 * Marks the cached content entries stale, so the next mount (or the live
 * observer) refetches them. Prefix matching is the point: the tracker holds
 * `content.all()`, and one key drops every content-derived query.
 */
export function invalidateContentCache(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: queryKeys.content.root() })
}

/**
 * Drops this tab's content cache whenever another tab reports an edit.
 * Returns the unsubscribe. Exported so the listener can be tested without a DOM.
 */
export function subscribeToContentChanges(queryClient: QueryClient): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {}

  const channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = () => invalidateContentCache(queryClient)

  return () => channel.close()
}

/**
 * Call after a mutation that changes `content_entries` (or the arcs they point
 * at). Marks the cached content stale and reloads it wherever it is mounted.
 */
export function useInvalidateContentCache() {
  const queryClient = useQueryClient()

  return useCallback(() => {
    invalidateContentCache(queryClient)
    broadcastContentChanged()
  }, [queryClient])
}

/** Keeps this tab's content cache in step with edits made in another tab. */
export function useContentCacheSync() {
  const queryClient = useQueryClient()

  useEffect(() => subscribeToContentChanges(queryClient), [queryClient])
}
