import type { NextRequest } from "next/server"

export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return true // same-origin navigations may omit it
  try {
    return new URL(origin).host === request.headers.get("host")
  } catch {
    return false
  }
}
