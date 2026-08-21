import { NextResponse } from "next/server"

import { getDcwEpisodeDetails } from "@/lib/dcw-episode"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function cleanParam(value: string | null): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim()
  if (!trimmed) return null
  return trimmed.slice(0, 200)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const dcwTitle = cleanParam(url.searchParams.get("title"))
  const fallbackTitle =
    cleanParam(url.searchParams.get("fallback")) ?? cleanParam(url.searchParams.get("q"))

  const episodeParam = url.searchParams.get("episode") ?? url.searchParams.get("episode_number")
  const parsedEpisode = episodeParam ? Number.parseInt(episodeParam, 10) : Number.NaN
  const episodeNumber = Number.isFinite(parsedEpisode) && parsedEpisode > 0 ? parsedEpisode : null

  const typeParam = url.searchParams.get("type")
  const contentType = typeParam && typeParam.trim() ? typeParam.trim().toLowerCase() : null

  if (!dcwTitle && !fallbackTitle) {
    return NextResponse.json(
      { ok: false, error: "Missing `title` or `fallback` query parameter." },
      { status: 400, headers: { "cache-control": "no-store" } },
    )
  }

  try {
    const details = await getDcwEpisodeDetails({
      dcwTitle,
      fallbackTitle,
      episodeNumber,
      contentType,
    })

    return NextResponse.json(
      {
        ok: true,
        data: details ?? null,
        requested: { title: dcwTitle, fallback: fallbackTitle },
      },
      {
        status: 200,
        headers: {
          "cache-control": details
            ? "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800"
            : "no-store",
        },
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      {
        ok: false,
        error: `Wiki lookup failed: ${message}`,
        requested: { title: dcwTitle, fallback: fallbackTitle },
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    )
  }
}
