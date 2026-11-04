import Link from "next/link"
import Image from "next/image"
import { ExternalLink, ImageOff, MapPin } from "lucide-react"
import { crimeGroupLabel, dcwPageUrl } from "@/lib/dcw-cases"
import { CONTENT_TYPES } from "@/lib/constants"
import { caseRef, type CaseCrime, type CaseFile } from "@/lib/cases-view"
import { cn } from "@/lib/utils"

/**
 * Badge tint per canonical crime group.
 *
 * Keyed by GROUP slug — the archive view stores groups in `crime_slug`, so
 * anything else here is a dead key. Violent crimes take the danger ramp,
 * acquisitive ones the accent ramp, the rest stay neutral so a page of files
 * is not a wall of colour.
 */
const CRIME_STYLES: Record<string, string> = {
  murder: "border-danger/30 bg-danger/10 text-danger",
  "attempted-murder": "border-danger/20 bg-danger/5 text-danger/90",
  kidnapping: "border-accent/30 bg-accent-soft text-accent-bright",
  bombing: "border-warning/25 bg-warning/10 text-warning",
  assault: "border-warning/20 bg-warning/5 text-warning/90",
  robbery: "border-accent/20 bg-accent-soft/50 text-accent-bright/90",
  fraud: "border-line bg-surface-muted text-ink",
  suicide: "border-line bg-surface-muted text-ink",
  accident: "border-line bg-surface-muted text-ink-dim",
  vandalism: "border-line bg-surface-muted text-ink-dim",
  "missing-person": "border-line bg-surface-muted text-ink-dim",
  other: "border-line bg-transparent text-ink-faint",
}

const NEUTRAL_STYLE = "border-line bg-surface-muted text-ink-dim"

function crimeStyle(slug: string): string {
  return CRIME_STYLES[slug] ?? NEUTRAL_STYLE
}

/**
 * One dossier page in the archive ledger.
 *
 * The reference in the left gutter is `caseRef` — the episode number, or the
 * content type for a movie/special. It replaces a "File no. 0001" that was
 * computed from the row's position in the FILTERED result set, so the same
 * case carried a different number under every filter and every page. A number
 * that renumbers itself is decoration pretending to be an identifier.
 *
 * The old left accent rail is gone: it restated the crime group the badge
 * already names, in a colour that was the only thing distinguishing adjacent
 * rows. Removing it makes the badge do the work and lets the row read as text.
 */

/**
 * Cover art for a case file.
 *
 * Sits at the far left of every row, matching the tracker's row anatomy, so the
 * artwork — not the label — is what identifies a case at a glance. `alt=""`
 * because the title is right there: repeating it would make a screen reader
 * announce every case twice.
 *
 * An entry with no artwork gets an icon in the same box rather than a broken
 * image, so the row geometry never shifts between the two states.
 */
function CaseArt({ url, className }: { url?: string | null; className?: string }) {
  return (
    <div
      className={cn(
        "relative aspect-[3/2] shrink-0 overflow-hidden rounded border border-line bg-surface-muted",
        className
      )}
    >
      {url ? (
        <Image
          src={url}
          alt=""
          fill
          sizes="(max-width: 640px) 80px, 112px"
          loading="lazy"
          className="object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-ink-faint/50">
          <ImageOff className="h-4 w-4" />
        </span>
      )}
    </div>
  )
}

export function CaseFileRow({ file }: { file: CaseFile }) {
  const ref = caseRef(file)
  const isEpisode = file.entryType === CONTENT_TYPES.EPISODE
  const episodeNumber = isEpisode ? file.entryEpisodeNumber : null
  const trackerHref =
    episodeNumber !== null && episodeNumber !== undefined
      ? `/tracker?ep=${episodeNumber}`
      : file.entrySlug
        ? `/tracker/${file.entrySlug}`
        : null
  const isMulti = file.crimes.length > 1
  const primary = file.crimes[0] ?? null

  // No case on file. More than a third of the catalogue is like this (DCW has
  // no crime template for 637 of 1,371 entries), and as a full row each one
  // cost 112px to say nothing. As a single muted line it still marks the entry
  // as visited without pretending to be a dossier page.
  if (file.crimes.length === 0) {
    return (
      <li className="border-b border-line">
        {/* Same 5.5rem gutter as a full row, so every title in the ledger
            starts at the same x whether or not the entry has a case. A flex
            row put the title wherever the reference ended — 269px after
            "EP 2", 319px after "MAGIC KAITO", against 336px for full rows. */}
        {/* Same grid template as a full row, so the artwork column and the
            reference column line up across both row types — otherwise the
            titles started ~70px apart and the list looked ragged. */}
        <div className="grid grid-cols-[5rem_4.5rem_minmax(0,1fr)] items-center gap-x-3 px-4 py-2 sm:grid-cols-[7rem_5.5rem_minmax(0,1fr)] sm:gap-x-5 sm:px-5">
          <CaseArt url={file.imageUrl} className="w-full" />
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint tabular-nums">
            {ref ?? ""}
          </span>
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-dim">
              {file.pageTitle}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
              no case on file
            </span>
          </div>
        </div>
      </li>
    )
  }

  return (
    <li className="group border-b border-line">
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-4 transition-colors hover:bg-surface-muted/40 sm:grid-cols-[7rem_5.5rem_minmax(0,1fr)] sm:gap-x-5 sm:px-5">
        {/* Artwork first, then the stable reference and air date. Both columns
            are fixed width so a column of episode numbers runs straight down
            the ledger. */}
        <CaseArt url={file.imageUrl} className="w-full self-start" />

        <div className="col-start-2 flex items-baseline gap-2 sm:col-start-2 sm:block">
          {ref && (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint tabular-nums">
              {ref}
            </span>
          )}
          {file.dateText && (
            <span className="font-mono text-[10px] text-ink-faint sm:mt-1 sm:block">
              {file.dateText}
            </span>
          )}
        </div>

        <div className="col-start-2 min-w-0 sm:col-start-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
            <h2 className="min-w-0 font-display text-base tracking-tight text-ink sm:text-lg">
              {file.pageTitle}
              {isMulti && (
                <span className="ml-2 font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-ink-dim">
                  {file.crimes.length} crimes
                </span>
              )}
            </h2>

            <span className="flex flex-wrap items-center gap-1">
              {file.crimeBadges.map((badge) => (
                <span
                  key={badge.slug || badge.type}
                  className={cn(
                    "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                    crimeStyle(badge.slug)
                  )}
                  title={`Filed under ${crimeGroupLabel(badge.slug)}`}
                >
                  {badge.type}
                  {badge.count > 1 && <span className="ml-1 opacity-70">&times;{badge.count}</span>}
                </span>
              ))}
            </span>
          </div>

          {isMulti ? (
            <>
              {/* Roll-up so the collapsed file still says who and where. */}
              <dl className="mt-2.5 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {file.victims.length > 0 && (
                  <Field
                    label={
                      file.victims.length > 1 ? "Victims" : (primary.victimLabel ?? "Victim")
                    }
                    value={file.victims.join(", ")}
                  />
                )}
                {file.locations.length > 0 && (
                  <Field
                    label={file.locations.length > 1 ? "Locations" : "Location"}
                    value={file.locations.join(", ")}
                    icon={<MapPin className="h-3 w-3" />}
                  />
                )}
              </dl>

              <details className="group/crimes mt-3">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-line bg-surface-muted px-2 py-1 font-mono text-[10px] text-ink-dim transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
                  <span className="group-open/crimes:hidden">
                    Open all {file.crimes.length} crime blocks
                  </span>
                  <span className="hidden group-open/crimes:inline">Collapse crime blocks</span>
                  <span className="text-[9px] transition-transform group-open/crimes:rotate-180">
                    &#9660;
                  </span>
                </summary>

                <ol className="mt-3 space-y-3 border-l border-line/60 pl-3">
                  {file.crimes.map((crime) => (
                    <li key={crime.id}>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                          Case {crime.caseIndex}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                            crimeStyle(crime.crimeSlug)
                          )}
                          title={`Filed under ${crimeGroupLabel(crime.crimeSlug)}`}
                        >
                          {crime.crimeType}
                        </span>
                      </div>

                      <CrimeFieldGrid crime={crime} />
                      {crime.description && <CaseSummarySpoiler description={crime.description} />}
                    </li>
                  ))}
                </ol>
              </details>
            </>
          ) : file.crimes.length === 1 ? (
            <>
              <CrimeFieldGrid crime={primary} />
              {primary.description && <CaseSummarySpoiler description={primary.description} />}
            </>
          ) : (
            <p className="mt-2 text-xs italic text-ink-faint">
              No crime data available for this entry.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-4">
            {trackerHref && (
              <Link
                href={trackerHref}
                className="font-mono text-[10px] text-accent-bright underline decoration-dotted transition-colors hover:text-accent"
              >
                {episodeNumber !== null
                  ? `open episode ${episodeNumber} in tracker →`
                  : "open in tracker →"}
              </Link>
            )}
            {file.pageTitle && file.pageTitle !== "Unknown" && (
              <a
                href={dcwPageUrl(file.pageTitle)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-faint underline decoration-dotted transition-colors hover:text-ink-dim"
              >
                read on DCW
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

function Field({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon?: React.ReactNode
}) {
  return (
    <div className="min-w-0 break-words">
      <dt className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-ink">{value}</dd>
    </div>
  )
}

function CrimeFieldGrid({ crime }: { crime: CaseCrime }) {
  return (
    <dl className="mt-2.5 grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {crime.victim && <Field label={crime.victimLabel ?? "Victim"} value={crime.victim} />}
      {crime.causeDeath && (
        <Field label={crime.causeDeathLabel ?? "Cause of death"} value={crime.causeDeath} />
      )}
      {crime.location && (
        <Field label="Location" value={crime.location} icon={<MapPin className="h-3 w-3" />} />
      )}
      {crime.suspects && <Field label={crime.suspectsLabel ?? "Suspects"} value={crime.suspects} />}
    </dl>
  )
}

function CaseSummarySpoiler({ description }: { description: string }) {
  return (
    <details className="group/spoiler mt-3">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-line bg-surface-muted px-2 py-1 font-mono text-[10px] text-ink-dim transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 [&::-webkit-details-marker]:hidden">
        <span className="group-open/spoiler:hidden">Unseal case summary (spoilers)</span>
        <span className="hidden group-open/spoiler:inline">Reseal summary</span>
      </summary>
      <p className="mt-2 select-none text-sm leading-relaxed text-ink-dim blur-sm transition-[filter] duration-200 group-open/spoiler:select-text group-open/spoiler:blur-none">
        {description}
      </p>
    </details>
  )
}
