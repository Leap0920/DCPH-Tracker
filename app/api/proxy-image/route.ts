import { NextResponse } from "next/server"

/** Only these hosts may be proxied — prevents this becoming an open relay/SSRF. */
const ALLOWED_HOSTS = new Set<string>([
  ...(process.env.NEXT_PUBLIC_SUPABASE_URL
    ? [new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host]
    : []),
  "lh3.googleusercontent.com",
  "avatars.githubusercontent.com",
])

const MAX_BYTES = 5 * 1024 * 1024

// A stalled upstream must 504 quickly, not pin an edge function for minutes.
const UPSTREAM_TIMEOUT_MS = 10_000

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url")
  if (!raw) return new NextResponse("Missing url", { status: 400 })

  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return new NextResponse("Invalid url", { status: 400 })
  }

  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.host)) {
    return new NextResponse("Host not allowed", { status: 403 })
  }

  const upstream = await fetch(target, {
    cache: "force-cache",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  if (!upstream.ok) return new NextResponse("Upstream error", { status: 502 })

  const contentType = upstream.headers.get("content-type") ?? ""
  if (!contentType.startsWith("image/")) {
    return new NextResponse("Not an image", { status: 415 })
  }

  const buffer = await upstream.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) {
    return new NextResponse("Too large", { status: 413 })
  }

  return new NextResponse(buffer, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=86400, immutable",
    },
  })
}
