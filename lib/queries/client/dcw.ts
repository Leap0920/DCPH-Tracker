"use client"

import { useCallback, useEffect, useState } from "react"

/* ------------------------------------------------------------------ */
/* Types (structural + permissive: the server may use slightly         */
/* different key names; the component normalises defensively)          */
/* ------------------------------------------------------------------ */

export type DcwUnknownRecord = Record<string, unknown>

export type DcwEpisodeDetails = {
  title?: string | null
  pageId?: number | null
  url?: string | null
  description?: string | null
  cast?: unknown[] | null
  gadgets?: unknown[] | null
  meta?: unknown
  plot?: unknown[] | null
} & DcwUnknownRecord

export type DcwStatus = "idle" | "loading" | "ready" | "error"

export type UseDcwEpisodeDetailsResult = {
  status: DcwStatus
  loading: boolean
  data: DcwEpisodeDetails | null
  error: string | null
  refresh: () => void
  /** Debug only: the exact query params that were sent. */
  requestedTitle: string | null
  requestedFallback: string | null
}

export type UseDcwEpisodeDetailsOptions = {
  dcwTitle?: string | null
  fallbackTitle?: string | null
  /** Optional hint: content_entries.episode_number. Absent -> identical behavior. */
  episodeNumber?: number | string | null
  /** Optional hint: content_entries.type ("episode" | "movie" | "ova" | "special"). */
  contentType?: string | null
  enabled?: boolean
}

/* ------------------------------------------------------------------ */
/* Module-level cache + dedup                                          */
/* ------------------------------------------------------------------ */

type CacheEntry = { data: DcwEpisodeDetails | null; ts: number }

const CACHE_TTL_MS = 30 * 60 * 1000

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<DcwEpisodeDetails | null>>()

function cleanTitle(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.replace(/\s+/g, " ").trim()
  if (!trimmed) return null
  return trimmed.slice(0, 200)
}

function cacheKeyFor(
  dcwTitle: string | null,
  fallbackTitle: string | null,
  episodeNumber: number | null,
  contentType: string | null,
): string | null {
  if (!dcwTitle && !fallbackTitle) return null
  return [
    (dcwTitle ?? "").toLowerCase(),
    (fallbackTitle ?? "").toLowerCase(),
    episodeNumber ?? "",
    contentType ?? "",
  ].join("|")
}

function normalizeEpisodeHint(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.trunc(parsed)
}

function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === "string" && err) return err
  return "Unknown error"
}

async function requestDetails(
  dcwTitle: string | null,
  fallbackTitle: string | null,
  episodeNumber: number | null,
  contentType: string | null,
): Promise<DcwEpisodeDetails | null> {
  const params = new URLSearchParams()
  if (dcwTitle) params.set("title", dcwTitle)
  if (fallbackTitle) params.set("fallback", fallbackTitle)
  if (episodeNumber !== null) params.set("episode", String(episodeNumber))
  if (contentType) params.set("type", contentType)

  const url = `/api/dcw/episode?${params.toString()}`

  // NOTE: intentionally no AbortSignal here. This promise is shared between
  // every consumer of the same cache key; aborting it for one unmounted
  // consumer (React StrictMode double-invokes effects in dev) would reject it
  // for all of them. Consumers ignore stale results via a `cancelled` flag.
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  })

  let json: unknown = null
  try {
    json = await response.json()
  } catch {
    throw new Error(`Bad JSON from ${url} (HTTP ${response.status})`)
  }

  const body = (json ?? {}) as { ok?: boolean; data?: unknown; error?: unknown }

  if (!response.ok || body.ok !== true) {
    const detail =
      typeof body.error === "string" && body.error
        ? body.error
        : `HTTP ${response.status}`
    throw new Error(`${detail} (${url})`)
  }

  if (!body.data || typeof body.data !== "object") return null
  return body.data as DcwEpisodeDetails
}

function getDetails(
  key: string,
  dcwTitle: string | null,
  fallbackTitle: string | null,
  episodeNumber: number | null,
  contentType: string | null,
): Promise<DcwEpisodeDetails | null> {
  const existing = inFlight.get(key)
  if (existing) return existing

  const promise = requestDetails(dcwTitle, fallbackTitle, episodeNumber, contentType)
    .then((data) => {
      cache.set(key, { data, ts: Date.now() })
      inFlight.delete(key)
      return data
    })
    .catch((err) => {
      inFlight.delete(key)
      throw err
    })

  inFlight.set(key, promise)
  return promise
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useDcwEpisodeDetails(
  options: UseDcwEpisodeDetailsOptions = {},
): UseDcwEpisodeDetailsResult {
  const dcwTitle = cleanTitle(options.dcwTitle)
  const fallbackTitle = cleanTitle(options.fallbackTitle)
  const episodeNumber = normalizeEpisodeHint(options.episodeNumber)
  const contentType =
    typeof options.contentType === "string" && options.contentType.trim()
      ? options.contentType.trim().toLowerCase()
      : null
  const key = cacheKeyFor(dcwTitle, fallbackTitle, episodeNumber, contentType)
  const enabled = options.enabled !== false && Boolean(key)

  const [nonce, setNonce] = useState(0)
  const [state, setState] = useState<{
    status: DcwStatus
    data: DcwEpisodeDetails | null
    error: string | null
  }>(() => {
    if (!enabled || !key) return { status: "idle", data: null, error: null }
    const hit = cache.get(key)
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return { status: "ready", data: hit.data, error: null }
    }
    return { status: "loading", data: null, error: null }
  })

  useEffect(() => {
    if (!enabled || !key) {
      setState({ status: "idle", data: null, error: null })
      return
    }

    let cancelled = false

    if (nonce === 0) {
      const hit = cache.get(key)
      if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
        setState({ status: "ready", data: hit.data, error: null })
        return
      }
    }

    setState({ status: "loading", data: null, error: null })

    getDetails(key, dcwTitle, fallbackTitle, episodeNumber, contentType)
      .then((data) => {
        if (cancelled) return
        setState({ status: "ready", data, error: null })
      })
      .catch((err) => {
        if (cancelled) return
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[dcw] episode details failed", { dcwTitle, fallbackTitle }, err)
        }
        setState({ status: "error", data: null, error: errorMessage(err) })
      })

    return () => {
      cancelled = true
    }
  }, [enabled, key, nonce, dcwTitle, fallbackTitle, episodeNumber, contentType])

  const refresh = useCallback(() => {
    if (key) {
      cache.delete(key)
      inFlight.delete(key)
    }
    setNonce((n) => n + 1)
  }, [key])

  return {
    status: state.status,
    loading: state.status === "loading",
    data: state.data,
    error: state.error,
    refresh,
    requestedTitle: dcwTitle,
    requestedFallback: fallbackTitle,
  }
}
