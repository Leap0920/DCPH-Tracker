"use client"

/*
  CharactersExplorer — orchestrator for /characters.

  The relationship filter chip and legend popover are handed to the graph as
  `topLeftSlot`, so they live in the SAME flex column as the search field and
  can no longer overlap it.

  What loads when:

  * first paint — the graph chunk (already async) with the lightweight cast the
    server sent: names, roles, factions, positions. No bios, no portraits, no
    dossier code;
  * on the first tap — the dossier chunk and that ONE character's portrait;
  * afterwards — nothing, because the dossier module caches what it fetched.

  Graphics quality is decided once, on the first visit, by asking the visitor to
  confirm what their device reported (see lib/device-tier.ts), and is theirs to
  change at any time from the Graphics chip.

  All characters and relationships are always visible and un-gated.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { RelationshipLegend } from "@/components/characters/RelationshipLegend"
import type { RelationshipMeta } from "@/components/characters/RelationshipLegend"
import { useTheme } from "@/components/theme-provider"
import { getRelationshipColor } from "@/components/characters/graph-theme"
import { ChevronDown, Filter, Gauge } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  TIER_COPY,
  downgrade,
  isStruggling,
  loadPreference,
  probeFrameHealth,
  readDeviceSignals,
  savePreference,
  suggestTier,
  type QualityPreference,
  type QualityTier,
  type TierSuggestion,
} from "@/lib/device-tier"
import type { Character, Relationship, RelationshipType } from "@/lib/characters-guide"

export interface CharactersExplorerProps {
  characters: Character[]
  relationships: Relationship[]
  relationshipMeta: RelationshipMeta
  isSignedIn?: boolean
  watchedEpisodes?: number[]
  watchedMovies?: number[]
  highestEpisode?: number
}

const CharactersWeb = dynamic(
  () => import("@/components/characters/CharactersWeb"),
  {
    ssr: false,
    loading: () => <GraphLoading />,
  }
)

/**
 * The dossier (panel + framer-motion + the on-demand guide) is the one part of
 * this page a visitor may never need, so it is fetched on the first tap rather
 * than shipped with the graph.
 */
const CharacterDossier = dynamic(
  () => import("@/components/characters/CharacterDossier"),
  { ssr: false, loading: () => null }
)

const QualityDialog = dynamic(
  () => import("@/components/characters/QualityDialog").then((m) => m.QualityDialog),
  { ssr: false, loading: () => null }
)

/** Idle ms before the dossier code is warmed, on devices that can spare it. */
const DOSSIER_WARMUP_MS = 2500

function GraphLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-page" aria-busy="true">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-faint border-t-accent" />
    </div>
  )
}

export default function CharactersExplorer({
  characters,
  relationships,
  relationshipMeta,
}: CharactersExplorerProps) {
  const [selection, setSelection] = useState<Character | null>(null)
  const [filter, setFilter] = useState<RelationshipType | null>(null)
  const [legendOpen, setLegendOpen] = useState(false)

  /* ── graphics quality ──────────────────────────────────────────── */
  /** null until the client resolves detection + storage (see the effect). */
  const [quality, setQuality] = useState<QualityTier | null>(null)
  const [preference, setPreference] = useState<QualityPreference | null>(null)
  const [suggestion, setSuggestion] = useState<TierSuggestion | null>(null)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [qualityNotice, setQualityNotice] = useState<string | null>(null)
  /** Latched on the first tap: the dossier module stays mounted afterwards so
   *  its exit animation survives, but it is not fetched before it is needed. */
  const [dossierReady, setDossierReady] = useState(false)
  /** The frame probe measures once per page load, never in a loop. */
  const probedRef = useRef(false)

  const { theme } = useTheme()
  const isDark = theme === "dark"

  // Detection and storage are client-only reads, so they cannot run during the
  // server render: the graph paints once the tier is known.
  useEffect(() => {
    const detected = suggestTier()
    const stored = loadPreference()
    setSuggestion(detected)
    setPreference(stored)
    setQuality(stored?.tier ?? detected.tier)
    if (!stored) setQualityOpen(true)
  }, [])

  const applyPreference = useCallback((next: QualityPreference) => {
    setPreference(next)
    setQuality(next.tier)
    setQualityNotice(null)
    savePreference(next)
    setQualityOpen(false)
  }, [])

  /**
   * Adaptive step: when the visitor accepted the detected tier (rather than
   * choosing one), watch the real frame times once and step down if the device
   * cannot hold them. An explicit choice is never overridden, and the tier is
   * never raised automatically — quality cannot oscillate.
   */
  useEffect(() => {
    if (!quality || !preference || preference.source !== "auto") return
    if (probedRef.current) return
    const next = downgrade(quality)
    if (next === quality) return
    probedRef.current = true
    let cancelled = false
    probeFrameHealth().then((health) => {
      if (cancelled || !isStruggling(health)) return
      const lowered: QualityPreference = { tier: next, source: "auto" }
      setPreference(lowered)
      setQuality(next)
      savePreference(lowered)
      setQualityNotice(
        `This device was dropping frames, so graphics were lowered to ${TIER_COPY[next].label}.`
      )
    })
    return () => {
      cancelled = true
    }
  }, [quality, preference])

  /**
   * Warm the dossier code while the visitor is only looking at the graph, so the
   * first tap opens instantly. Skipped on the low tier and on metered or slow
   * connections — there the first tap waits for the download instead.
   */
  useEffect(() => {
    if (!quality || quality === "low") return
    const signals = readDeviceSignals()
    if (signals.saveData) return
    if (signals.effectiveType && ["slow-2g", "2g", "3g"].includes(signals.effectiveType)) {
      return
    }
    const timer = window.setTimeout(() => {
      void import("@/components/characters/CharacterDossier")
    }, DOSSIER_WARMUP_MS)
    return () => window.clearTimeout(timer)
  }, [quality])

  const handleSelect = useCallback((character: Character | null) => {
    if (character) {
      setDossierReady(true)
      // Kick the portrait off at the tap: its path rides along with the
      // lightweight character, so those bytes are in flight while the dossier
      // chunk is still being fetched.
      if (character.image) {
        const preload = new window.Image()
        preload.decoding = "async"
        preload.src = character.image
      }
    }
    setSelection(character)
  }, [])

  const filterControls = useMemo(
    () => (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setLegendOpen((v) => !v)}
          aria-expanded={legendOpen}
          className={cn(
            "group flex w-full items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-lift transition-all",
            "border-line bg-surface text-ink hover:border-ink-faint/40 hover:bg-surface-muted",
          )}
        >
          <Filter className="h-3.5 w-3.5 shrink-0 text-accent-bright transition-transform duration-300 group-hover:rotate-12" />
          <span className="min-w-0 flex-1 truncate text-left">
            {filter ? relationshipMeta[filter].label : "All Relationships"}
          </span>
          {filter && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: getRelationshipColor(filter, isDark) }}
            />
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-300",
              legendOpen && "rotate-180",
            )}
          />
        </button>

        {/* CSS grid-rows disclosure instead of AnimatePresence: the filter chip
            is part of the first paint, and keeping framer-motion out of this
            component keeps ~37 kB (gzipped) out of the page's first load. */}
        <div
          className={cn(
            "grid transition-all duration-300 ease-out",
            legendOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden" inert={!legendOpen}>
            <div className="max-h-[52vh] overflow-y-auto rounded-2xl border border-line bg-surface p-3 text-ink shadow-lift">
              <div className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                Filter by relationship
              </div>
              <RelationshipLegend
                meta={relationshipMeta}
                activeFilter={filter}
                onFilterType={setFilter}
                compact
              />
            </div>
          </div>
        </div>

        {/* Graphics tier — always reachable, so a wrong first guess (or a device
            that behaves unlike its specs) is never a dead end. */}
        <button
          type="button"
          onClick={() => setQualityOpen(true)}
          aria-label={`Graphics quality: ${quality ? TIER_COPY[quality].label : "detecting"}`}
          className={cn(
            "group flex w-full items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold shadow-lift transition-all",
            "border-line bg-surface text-ink hover:border-ink-faint/40 hover:bg-surface-muted",
          )}
        >
          <Gauge className="h-3.5 w-3.5 shrink-0 text-accent-bright" />
          <span className="min-w-0 flex-1 truncate text-left">
            {quality ? `Graphics · ${TIER_COPY[quality].label}` : "Graphics"}
          </span>
          {qualityNotice && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent-bright" aria-hidden />
          )}
        </button>
      </div>
    ),
    [legendOpen, filter, relationshipMeta, isDark, quality, qualityNotice],
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-page text-ink transition-colors duration-300">
      {quality ? (
        <CharactersWeb
          characters={characters}
          relationships={relationships}
          quality={quality}
          onSelectCharacter={handleSelect}
          selectedCharacterId={selection?.id}
          activeFilter={filter}
          topLeftSlot={filterControls}
          theme={theme}
          className="h-full w-full rounded-none border-none shadow-none"
        />
      ) : (
        // At most one frame: detection is synchronous once the browser is here.
        <GraphLoading />
      )}

      {/* Stays mounted after the first tap — the wrapper owns the exit animation. */}
      {dossierReady && (
        <CharacterDossier
          character={selection}
          meta={relationshipMeta}
          filter={filter}
          onClose={() => setSelection(null)}
        />
      )}

      {suggestion && (
        <QualityDialog
          open={qualityOpen}
          onOpenChange={(open) => {
            // Dismissing the first-run prompt means "keep what you detected".
            if (!open && !preference) {
              applyPreference({ tier: suggestion.tier, source: "auto" })
              return
            }
            setQualityOpen(open)
          }}
          preference={preference}
          suggestion={suggestion}
          notice={qualityNotice}
          onApply={applyPreference}
        />
      )}
    </div>
  )
}
