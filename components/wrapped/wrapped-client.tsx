"use client"

import { useEffect, useRef, useState } from "react"
import { Download, Loader2, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardFrame } from "./card-frame"
import { CharacterPicker } from "./character-picker"
import { StatsCard } from "./stats-card"
import { DEFAULT_BACKGROUND_ID, getBackground } from "@/lib/wrapped/characters"
import {
  canShareFiles,
  dataUrlToFile,
  downloadDataUrl,
  renderCardToPng,
  shareFile,
} from "@/lib/wrapped/export"
import type { WrappedStats } from "@/lib/queries/wrapped"

type Props = {
  displayName: string
  username: string
  avatarUrl: string | null
  stats: WrappedStats
  issuedOn: string
}

export function WrappedClient({
  displayName,
  username,
  avatarUrl,
  stats,
  issuedOn,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [backgroundId, setBackgroundId] = useState(DEFAULT_BACKGROUND_ID)
  const [busy, setBusy] = useState<"download" | "share" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shareable, setShareable] = useState(false)

  useEffect(() => setShareable(canShareFiles()), [])

  const filename = `dcph-wrapped-${username}.png`

  async function run(mode: "download" | "share") {
    if (!cardRef.current || busy) return
    setBusy(mode)
    setError(null)
    try {
      const dataUrl = await renderCardToPng(cardRef.current)
      if (mode === "download") {
        downloadDataUrl(dataUrl, filename)
      } else {
        await shareFile(await dataUrlToFile(dataUrl, filename), "My DCPH Wrapped")
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setError("Could not generate the image. Try again.")
        console.error(e)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-12">
      <div className="mx-auto w-full max-w-[420px] lg:max-w-[480px]">
        <CardFrame>
          <StatsCard
            ref={cardRef}
            displayName={displayName}
            username={username}
            avatarUrl={avatarUrl}
            stats={stats}
            background={getBackground(backgroundId)}
            issuedOn={issuedOn}
          />
        </CardFrame>
      </div>

      <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
            Your Wrapped
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">
            Pick a background, download the card, post it anywhere.
          </p>
        </div>

        <CharacterPicker value={backgroundId} onChange={setBackgroundId} />

        <div className="flex flex-col gap-2">
          <Button
            onClick={() => run("download")}
            disabled={busy !== null}
            className="h-10 w-full bg-white text-black hover:bg-neutral-200"
          >
            {busy === "download" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download PNG
          </Button>

          {shareable ? (
            <Button
              variant="outline"
              onClick={() => run("share")}
              disabled={busy !== null}
              className="h-10 w-full border-line bg-transparent text-ink-dim hover:bg-white/[0.04]"
            >
              {busy === "share" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Share2 className="mr-2 h-4 w-4" />
              )}
              Share
            </Button>
          ) : null}

          <p className="text-[11px] text-ink-faint">1080 × 1350 · PNG</p>
          {error ? (
            <p role="alert" className="text-[11px] text-accent-bright">
              {error}
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
