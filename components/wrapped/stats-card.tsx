"use client"

import { forwardRef } from "react"
import Image from "next/image"
import { backgroundSrc, type WrappedBackground } from "@/lib/wrapped/characters"
import { CARD_HEIGHT, CARD_WIDTH } from "@/lib/wrapped/export"
import type { WrappedStats } from "@/lib/queries/wrapped"

const ACCENT = "#ED2A42"

const TYPE_COLORS: Record<string, string> = {
  episode: "#ED2A42",
  movie: "#C8102E",
  special: "#7A2230",
  ova: "#4A4A4A",
  live_action: "#5C3D2E",
  magic_kaito: "#3B5998",
  hanzawa: "#2A2A2A",
  zero_tea_time: "#6B5B3E",
  yaiba: "#10B981",
  other: "#2A2A2A",
}

const TYPE_LABELS: Record<string, string> = {
  episode: "Episodes",
  movie: "Movies",
  special: "Specials",
  ova: "OVAs",
  live_action: "Live Action",
  magic_kaito: "Magic Kaito",
  hanzawa: "Hanzawa",
  zero_tea_time: "Zero's Tea Time",
  yaiba: "Yaiba",
  other: "Other",
}

export type StatsCardProps = {
  displayName: string
  username: string
  avatarUrl: string | null
  stats: WrappedStats
  background: WrappedBackground
  /** Rendered as-is; pass a stable string from the server to avoid hydration drift. */
  issuedOn: string
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ letterSpacing: "0.24em" }}
      className="font-mono text-[20px] font-medium uppercase text-white/80 [text-shadow:0_2px_8px_rgba(0,0,0,0.85)]"
    >
      {children}
    </div>
  )
}

function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-[10px]">
      <Label>{label}</Label>
      <div className="flex items-baseline gap-[10px]">
        <span className="font-display text-[76px] font-semibold leading-none tracking-[-0.02em] text-white tabular-nums [text-shadow:0_3px_16px_rgba(0,0,0,0.9)]">
          {value}
        </span>
        {sub ? (
          <span className="text-[24px] leading-none text-white/70 tabular-nums [text-shadow:0_2px_8px_rgba(0,0,0,0.85)]">
            {sub}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** Splits "3d 4h 12m" into styled segments. */
function Watchtime({ formatted }: { formatted: string }) {
  const parts = formatted.match(/\d+[a-z]/gi) ?? [formatted]
  return (
    <div className="flex items-end gap-[24px]">
      {parts.map((part) => {
        const value = part.slice(0, -1)
        const unit = part.slice(-1)
        return (
          <div key={part} className="flex items-end gap-[6px]">
            <span className="font-display text-[132px] font-semibold leading-[0.82] tracking-[-0.04em] text-white tabular-nums [text-shadow:0_4px_20px_rgba(0,0,0,0.95)]">
              {value}
            </span>
            <span className="font-display text-[44px] font-medium leading-none text-white/80 [text-shadow:0_2px_10px_rgba(0,0,0,0.9)]">
              {unit}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export const StatsCard = forwardRef<HTMLDivElement, StatsCardProps>(
  function StatsCard(
    { displayName, username, avatarUrl, stats, background, issuedOn },
    ref,
  ) {
    const total = stats.byType.reduce((sum, s) => sum + s.count, 0) || 1

    return (
      <div
        ref={ref}
        style={{ width: CARD_WIDTH, height: CARD_HEIGHT, backgroundColor: "#0A0A0A" }}
        className="relative overflow-hidden rounded-[40px]"
      >
        {/* background art */}
        <Image
          src={backgroundSrc(background.file)}
          alt=""
          width={CARD_WIDTH}
          height={CARD_HEIGHT}
          unoptimized
          crossOrigin="anonymous"
          priority
          style={{ objectPosition: background.focus ?? "50% 25%" }}
          className="absolute inset-0 h-full w-full object-cover opacity-[0.85] saturate-[0.95] contrast-[1.06]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/25 to-black/80" />
        <div className="absolute inset-0 rounded-[40px] ring-1 ring-inset ring-white/10" />

        {/* content */}
        <div className="relative flex h-full flex-col px-[72px] py-[68px]">
          {/* header — the left block is allowed to compress (min-w-0 + a
              wrapping badge) so the DCPH/WRAPPED mark on the right can
              never be pushed past the card edge, even with the longest
              rank titles or fallback fonts on slow phones. */}
          <div className="flex items-start justify-between">
            <div className="flex min-w-0 items-center gap-[24px]">
              <div className="h-[104px] w-[104px] shrink-0 overflow-hidden rounded-full ring-1 ring-white/20 shadow-md">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={displayName}
                    width={104}
                    height={104}
                    unoptimized
                    crossOrigin="anonymous"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/[0.1] text-[40px] font-semibold text-white">
                    {displayName.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-[6px]">
                <div className="truncate font-display text-[46px] font-semibold leading-none tracking-[-0.02em] text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.9)]">
                  {displayName}
                </div>
                <div className="flex flex-wrap items-center gap-x-[14px] gap-y-[8px]">
                  <span className="font-mono text-[26px] leading-none text-white/70 [text-shadow:0_2px_8px_rgba(0,0,0,0.85)]">
                    @{username}
                  </span>
                  {stats.rankTitle ? (
                    <span className="whitespace-nowrap rounded-full border border-white/20 bg-black/40 px-[14px] py-[3px] font-mono text-[16px] font-medium text-white/90 shadow-sm backdrop-blur-sm">
                      {stats.rankTitle}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-[8px] [text-shadow:0_2px_10px_rgba(0,0,0,0.9)]">
              <div className="font-display text-[30px] font-bold leading-none tracking-[-0.01em] text-white">
                DCPH
              </div>
              <div
                style={{ letterSpacing: "0.34em", color: ACCENT }}
                className="text-[18px] font-semibold uppercase drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]"
              >
                Wrapped
              </div>
            </div>
          </div>

          {/* hero */}
          <div className="mt-[92px] flex flex-col gap-[22px]">
            <Label>Total watchtime</Label>
            <Watchtime formatted={stats.timeFormatted} />
            <div className="font-mono text-[24px] text-white/70 tabular-nums [text-shadow:0_2px_8px_rgba(0,0,0,0.85)]">
              {stats.totalMinutes.toLocaleString()} minutes on the case
            </div>
          </div>

          {/* perforation */}
          <div className="relative mt-[76px]">
            <div
              style={{ backgroundColor: "#050505" }}
              className="absolute left-[-96px] top-1/2 h-[48px] w-[48px] -translate-y-1/2 rounded-full"
            />
            <div
              style={{ backgroundColor: "#050505" }}
              className="absolute right-[-96px] top-1/2 h-[48px] w-[48px] -translate-y-1/2 rounded-full"
            />
            <div className="border-t border-dashed border-white/30" />
          </div>

          {/* stat grid */}
          <div className="mt-[64px] grid grid-cols-2 gap-y-[58px] gap-x-[40px]">
            <Stat
              value={stats.casesSolved.toLocaleString()}
              label="Cases solved"
              sub={`/ ${stats.totalCatalogCount.toLocaleString()}`}
            />
            <Stat value={`${stats.completionPct}%`} label="Catalog complete" />
            <Stat value={stats.totalRewatchViews.toLocaleString()} label="Total rewatches" />
            <Stat
              value={stats.avgRating && stats.avgRating > 0 ? stats.avgRating.toFixed(1) : "—"}
              label="Avg rating"
              sub={stats.avgRating && stats.avgRating > 0 ? "/ 10" : undefined}
            />
          </div>

          {/* type breakdown */}
          {stats.byType.length > 0 ? (
            <div className="mt-auto flex flex-col gap-[20px]">
              <Label>Breakdown</Label>
              <div className="flex h-[12px] w-full gap-[4px] overflow-hidden rounded-full shadow-inner bg-black/40">
                {stats.byType.map((slice) => (
                  <div
                    key={slice.type}
                    style={{
                      width: `${(slice.count / total) * 100}%`,
                      backgroundColor: TYPE_COLORS[slice.type] ?? TYPE_COLORS.other,
                    }}
                    className="h-full rounded-full"
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-[36px] gap-y-[12px]">
                {stats.byType.map((slice) => (
                  <div key={slice.type} className="flex items-center gap-[12px] [text-shadow:0_2px_8px_rgba(0,0,0,0.85)]">
                    <span
                      style={{
                        backgroundColor: TYPE_COLORS[slice.type] ?? TYPE_COLORS.other,
                      }}
                      className="h-[12px] w-[12px] rounded-full shadow-sm"
                    />
                    <span className="text-[24px] text-white/90">
                      {TYPE_LABELS[slice.type] ?? slice.type}
                    </span>
                    <span className="font-mono text-[24px] text-white/70 tabular-nums">
                      {slice.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-auto" />
          )}

          {/* footer */}
          <div className="mt-[56px] flex items-end justify-between border-t border-white/[0.12] pt-[32px] [text-shadow:0_1px_6px_rgba(0,0,0,0.8)]">
            <div className="font-mono text-[22px] text-white/70">
              dcphtracker.vercel.app/{username}
            </div>
            <div className="font-mono text-[22px] uppercase text-white/60">
              {issuedOn}
            </div>
          </div>
        </div>
      </div>
    )
  },
)
