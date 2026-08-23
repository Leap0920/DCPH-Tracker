import { NextResponse } from "next/server"
import { logger } from "@/lib/logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

type CheckStatus = "ok" | "degraded" | "down" | "skipped"

type Check = {
  status: CheckStatus
  latencyMs?: number
  error?: string
}

const DB_TIMEOUT_MS = 3_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    ),
  ])
}

/**
 * Cheap Supabase reachability probe using the anon key over REST.
 * Deliberately avoids the cookie-bound server client so the endpoint works
 * unauthenticated, and avoids the service-role key so a leak here is harmless.
 */
async function checkSupabase(): Promise<Check> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    return { status: "skipped", error: "supabase env vars not configured" }
  }

  const started = Date.now()
  try {
    const response = await withTimeout(
      fetch(`${url}/rest/v1/`, {
        method: "HEAD",
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
      }),
      DB_TIMEOUT_MS
    )

    const latencyMs = Date.now() - started

    if (!response.ok && response.status >= 500) {
      return { status: "down", latencyMs, error: `HTTP ${response.status}` }
    }
    if (latencyMs > 1_000) {
      return { status: "degraded", latencyMs }
    }
    return { status: "ok", latencyMs }
  } catch (error) {
    return {
      status: "down",
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "unknown error",
    }
  }
}

export async function GET() {
  const started = Date.now()
  const supabase = await checkSupabase()

  const status: CheckStatus =
    supabase.status === "down"
      ? "down"
      : supabase.status === "degraded"
        ? "degraded"
        : "ok"

  const body = {
    status,
    timestamp: new Date().toISOString(),
    version:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
      process.env.npm_package_version ??
      "unknown",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    region: process.env.VERCEL_REGION ?? null,
    uptimeSeconds: Math.round(process.uptime()),
    checks: { supabase },
    durationMs: Date.now() - started,
  }

  if (status === "down") {
    logger.error("health_check_failed", { checks: body.checks })
  }

  // 503 when down so uptime monitors alert without parsing the body.
  return NextResponse.json(body, {
    status: status === "down" ? 503 : 200,
    headers: {
      "Cache-Control": "no-store, max-age=0, must-revalidate",
      "Content-Type": "application/json",
    },
  })
}

export async function HEAD() {
  const supabase = await checkSupabase()
  return new Response(null, {
    status: supabase.status === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  })
}
