"use client"

import { useMemo } from "react"

import { useDcwEpisodeDetails } from "@/lib/queries/client/dcw"

type EpisodeWikiDetailsProps = {
  dcwTitle?: string | null
  /** Fallback search title (usually the tracker entry title). */
  title?: string | null
  fallbackTitle?: string | null
  /** Optional hint: content_entries.episode_number. */
  episodeNumber?: number | string | null
  /** Optional hint: content_entries.type. */
  contentType?: string | null
  className?: string
}

/* ------------------------------------------------------------------ */
/* Defensive normalisation                                             */
/* ------------------------------------------------------------------ */

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim()
    return t ? t : null
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function pickStr(rec: Rec, keys: string[]): string | null {
  for (const k of keys) {
    const v = str(rec[k])
    if (v) return v
  }
  return null
}

function pickStrList(rec: Rec, keys: string[]): string[] {
  for (const k of keys) {
    const v = rec[k]
    if (Array.isArray(v)) {
      const list = v.map(str).filter((x): x is string => Boolean(x))
      if (list.length) return list
    }
    const single = str(v)
    if (single) return [single]
  }
  return []
}

function pickBool(rec: Rec, keys: string[]): boolean {
  for (const k of keys) {
    if (typeof rec[k] === "boolean") return rec[k] as boolean
  }
  return false
}

type CastRow = { character: string; actors: string[] }
type GadgetRow = { name: string; note: string | null; introduced: boolean }
type MetaRow = { label: string; value: string }

// Wiki leads often begin with a stripped template ({{nihongo|...}}, {{PAGENAME}}),
// leaving a dangling ", known as ..." fragment. Clean that up defensively.
const LEADING_JUNK_RE = /^[\s,;:.!?·—–\-)\]}]+/u

function cleanDescription(text: string | null, pageTitle?: string | null): string | null {
  if (!text) return null
  let out = text.replace(/\r\n/g, "\n")
  out = out.replace(/\(\s*[,;:]*\s*\)/g, "") // empty parens left by stripped templates
  out = out.replace(/[ \t]+([,;:.!?])/g, "$1") // space before punctuation
  out = out.replace(/,\s*,+/g, ",") // doubled commas
  out = out.replace(/[ \t]{2,}/g, " ")
  out = out.trim()

  if (LEADING_JUNK_RE.test(out)) {
    const stripped = out.replace(LEADING_JUNK_RE, "").trim()
    if (!stripped) return null
    const title = pageTitle?.trim()
    out = title ? `${title}, ${stripped}` : stripped.charAt(0).toUpperCase() + stripped.slice(1)
  }

  return out.trim() || null
}

function normaliseCast(input: unknown): CastRow[] {
  if (!Array.isArray(input)) return []
  const rows: CastRow[] = []
  for (const item of input) {
    if (typeof item === "string") {
      const v = str(item)
      if (v) rows.push({ character: v, actors: [] })
      continue
    }
    if (!isRec(item)) continue
    const character = pickStr(item, ["character", "role", "name", "label"])
    const actors = pickStrList(item, [
      "actors",
      "voiceActors",
      "voices",
      "actor",
      "value",
      "values",
    ])
    if (character || actors.length) {
      rows.push({ character: character ?? "—", actors })
    }
  }
  return rows
}

function normaliseGadgets(input: unknown): GadgetRow[] {
  if (!Array.isArray(input)) return []
  const rows: GadgetRow[] = []
  for (const item of input) {
    if (typeof item === "string") {
      const v = str(item)
      if (v) rows.push({ name: v, note: null, introduced: false })
      continue
    }
    if (!isRec(item)) continue
    const name = pickStr(item, ["name", "gadget", "title", "label"])
    if (!name) continue
    rows.push({
      name,
      note: pickStr(item, ["note", "description", "detail", "value"]),
      introduced: pickBool(item, ["introduced", "isNew", "first", "firstAppearance"]),
    })
  }
  return rows
}

function normaliseMeta(input: unknown): MetaRow[] {
  const rows: MetaRow[] = []
  if (Array.isArray(input)) {
    for (const item of input) {
      if (Array.isArray(item) && item.length >= 2) {
        const label = str(item[0])
        const value = str(item[1])
        if (label && value) rows.push({ label, value })
        continue
      }
      if (!isRec(item)) continue
      const label = pickStr(item, ["label", "key", "name", "field"])
      const value = pickStr(item, ["value", "text", "content"])
      if (label && value) rows.push({ label, value })
    }
    return rows
  }
  if (isRec(input)) {
    for (const [label, raw] of Object.entries(input)) {
      const value = Array.isArray(raw)
        ? raw.map(str).filter((x): x is string => Boolean(x)).join(", ")
        : str(raw)
      if (label && value) rows.push({ label, value })
    }
  }
  return rows
}

/* ------------------------------------------------------------------ */
/* Presentational bits                                                 */
/* ------------------------------------------------------------------ */

function SectionShell({
  children,
  className,
  right,
}: {
  children: React.ReactNode
  className?: string
  right?: React.ReactNode
}) {
  return (
    <section
      data-dcw-details="1"
      className={`border-t border-line pt-6 ${className ?? ""}`}
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-sm text-ink-dim">From Detective Conan World</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 font-display text-xs uppercase tracking-wider text-ink-dim/70">
      {children}
    </h3>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="h-3 w-full animate-pulse rounded bg-ink/10" />
      <div className="h-3 w-11/12 animate-pulse rounded bg-ink/10" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-ink/10" />
      <div className="mt-4 h-3 w-1/3 animate-pulse rounded bg-ink/10" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-ink/10" />
    </div>
  )
}

function Notice({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded border border-line bg-surface/40 px-3 py-2">
      <p className="font-body text-xs text-ink-dim">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="font-display text-xs text-accent underline decoration-line underline-offset-4 transition-colors hover:text-ink"
        >
          Retry
        </button>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function EpisodeWikiDetails({
  dcwTitle,
  title,
  fallbackTitle,
  episodeNumber,
  contentType,
  className,
}: EpisodeWikiDetailsProps) {
  const fallback = fallbackTitle ?? title ?? null

  const {
    status,
    data,
    error,
    refresh,
  } = useDcwEpisodeDetails({
    dcwTitle,
    fallbackTitle: fallback,
    episodeNumber,
    contentType,
  })

  const normalised = useMemo(() => {
    if (!data) {
      return {
        description: null as string | null,
        cast: [] as CastRow[],
        gadgets: [] as GadgetRow[],
        meta: [] as MetaRow[],
        url: null as string | null,
        pageTitle: null as string | null,
      }
    }
    const descRaw = (data as Rec).description
    const descText = typeof descRaw === "string" ? descRaw : str(descRaw)
    const pageTitle = str(data.title)
    return {
      description: cleanDescription(descText, pageTitle),
      cast: normaliseCast(data.cast),
      gadgets: normaliseGadgets(data.gadgets),
      meta: normaliseMeta(data.meta),
      url: str(data.url),
      pageTitle,
    }
  }, [data])

  const hasAnything =
    Boolean(normalised.description) ||
    normalised.cast.length > 0 ||
    normalised.gadgets.length > 0 ||
    normalised.meta.length > 0

  const sourceLink =
    normalised.url ? (
      <a
        href={normalised.url}
        target="_blank"
        rel="noreferrer noopener"
        className="font-display text-xs text-ink-dim/70 underline decoration-line underline-offset-4 transition-colors hover:text-ink"
      >
        {normalised.pageTitle ?? "Source"}
      </a>
    ) : null

  if (status === "idle") {
    return (
      <SectionShell className={className}>
        <Notice message="No wiki title available for this entry." />
      </SectionShell>
    )
  }

  if (status === "loading") {
    return (
      <SectionShell className={className}>
        <Skeleton />
      </SectionShell>
    )
  }

  if (status === "error") {
    return (
      <SectionShell className={className}>
        <Notice message={error ?? "Could not load wiki details."} onRetry={refresh} />
      </SectionShell>
    )
  }

  if (!hasAnything) {
    return (
      <SectionShell className={className}>
        <Notice message="No wiki details found for this episode." onRetry={refresh} />
      </SectionShell>
    )
  }

  return (
    <SectionShell className={className} right={sourceLink}>
      <div className="space-y-6">
        {normalised.description ? (
          <p className="font-body leading-relaxed text-ink-dim">{normalised.description}</p>
        ) : null}

        {normalised.meta.length > 0 ? (
          <div>
            <SubHeading>Details</SubHeading>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {normalised.meta.map((row) => (
                <div
                  key={`${row.label}-${row.value}`}
                  className="flex gap-2 border-b border-line/60 py-1"
                >
                  <dt className="min-w-[7.5rem] shrink-0 font-body text-xs text-ink-dim/70">
                    {row.label}
                  </dt>
                  <dd className="font-body text-xs text-ink-dim">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {normalised.gadgets.length > 0 ? (
          <div>
            <SubHeading>Gadgets</SubHeading>
            <ul className="space-y-1">
              {normalised.gadgets.map((gadget) => (
                <li key={gadget.name} className="font-body text-xs text-ink-dim">
                  <span className="text-ink">{gadget.name}</span>
                  {gadget.introduced ? (
                    <span className="ml-2 rounded border border-line px-1.5 py-0.5 font-display text-[10px] uppercase tracking-wider text-accent">
                      introduced
                    </span>
                  ) : null}
                  {gadget.note ? (
                    <span className="ml-2 text-ink-dim/70">{gadget.note}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {normalised.cast.length > 0 ? (
          <div>
            <SubHeading>Voice cast</SubHeading>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {normalised.cast.map((row, index) => (
                <li
                  key={`${row.character}-${index}`}
                  className="flex gap-2 border-b border-line/60 py-1 font-body text-xs"
                >
                  <span className="min-w-[7.5rem] shrink-0 text-ink">{row.character}</span>
                  <span className="text-ink-dim/80">
                    {row.actors.length ? row.actors.join(" / ") : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionShell>
  )
}

export default EpisodeWikiDetails
