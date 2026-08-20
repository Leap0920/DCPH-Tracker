import Link from "next/link"
import { ArrowRight, BookOpen, Users, Video } from "lucide-react"
import { searchAll } from "@/lib/queries/search"
import { SearchInput } from "@/components/search/SearchInput"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { typeBadgeClass } from "@/lib/badges"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Search · Detective Conan PH",
  description: "Search episodes, story arcs, and detectives.",
}

function SectionHeading({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode
  label: string
  count: number
}) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      {icon}
      <h2 className="font-display text-sm tracking-tight text-ink-dim uppercase">
        {label}
      </h2>
      <span className="text-xs font-mono text-ink-faint">({count})</span>
      <span className="redacted-bar w-16" />
    </div>
  )
}

function EntryCard({
  entry,
}: {
  entry: { slug: string; title: string; type: ContentType; image_url: string | null }
}) {
  return (
    <Link
      href={`/tracker/${entry.slug}`}
      className="flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5 transition-colors hover:border-ink-faint/40 hover:bg-surface-muted"
    >
      <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-md bg-surface-muted">
        {entry.image_url ? (
          <img
            src={entry.image_url}
            alt={entry.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Video className="h-5 w-5 text-ink-faint" />
          </div>
        )}
      </div>
      <div className="min-w-0">
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono",
            typeBadgeClass[entry.type] ?? typeBadgeClass.episode
          )}
        >
          {CONTENT_TYPE_LABELS[entry.type]}
        </span>
        <h3 className="mt-1 truncate text-sm font-display tracking-tight text-ink">
          {entry.title}
        </h3>
      </div>
    </Link>
  )
}

function ArcRow({ arc }: { arc: { slug: string; title: string } }) {
  return (
    <Link
      href={`/arcs/${arc.slug}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:border-ink-faint/40 hover:bg-surface-muted"
    >
      <span className="flex items-center gap-2.5 text-sm font-display tracking-tight text-ink">
        <BookOpen className="h-4 w-4 shrink-0 text-ink-faint" />
        {arc.title}
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
    </Link>
  )
}

function UserRow({
  user,
}: {
  user: { username: string; display_name: string; avatar_url: string | null }
}) {
  const name = user.display_name || user.username
  return (
    <Link
      href={`/profile/${user.username}`}
      className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 transition-colors hover:border-ink-faint/40 hover:bg-surface-muted"
    >
      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-surface-muted">
        {user.avatar_url ? (
          <img src={user.avatar_url} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Users className="h-4 w-4 text-ink-faint" />
          </div>
        )}
      </div>
      <span className="min-w-0">
        <span className="block truncate text-sm font-display tracking-tight text-ink">
          {name}
        </span>
        <span className="block text-xs text-ink-dim">@{user.username}</span>
      </span>
      <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-ink-faint" />
    </Link>
  )
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const sp = await searchParams
  const q = sp.q?.trim() ?? ""
  const results = q ? await searchAll(q) : null

  const hasResults =
    results !== null &&
    (results.entries.length > 0 ||
      results.arcs.length > 0 ||
      results.profiles.length > 0)

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">GLOBAL SEARCH · CASE INDEX</span>
          <span className="redacted-bar w-16" />
        </div>

        <h1 className="font-display text-3xl sm:text-4xl tracking-tight text-ink">
          Search
        </h1>
        <p className="mt-2 max-w-xl text-ink-dim">
          Dig through episodes, story arcs, and the detective roster.
        </p>

        <div className="mt-6">
          <SearchInput initialValue={q} />
        </div>

        {!q && (
          <div className="mt-16 rounded-2xl border border-dashed border-line bg-surface-muted p-10 text-center">
            <p className="font-display text-lg tracking-tight text-ink">
              Search episodes, arcs, and detectives
            </p>
            <p className="mt-1 text-sm text-ink-dim">
              Start typing a case title, a character, or a detective&apos;s name.
            </p>
          </div>
        )}

        {q && !hasResults && (
          <div className="mt-16 rounded-2xl border border-dashed border-line bg-surface-muted p-10 text-center">
            <p className="font-display text-lg tracking-tight text-ink">
              No results for &quot;{q}&quot;
            </p>
            <p className="mt-1 text-sm text-ink-dim">
              Try a different keyword — case titles, arc names, or usernames.
            </p>
          </div>
        )}

        {results && hasResults && (
          <div className="mt-8 space-y-10">
            {results.entries.length > 0 && (
              <section aria-label="Matching episodes">
                <SectionHeading
                  icon={<Video className="h-4 w-4 text-ink-dim" />}
                  label="Entries"
                  count={results.entries.length}
                />
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {results.entries.map((entry) => (
                    <EntryCard key={entry.slug} entry={entry} />
                  ))}
                </div>
              </section>
            )}

            {results.arcs.length > 0 && (
              <section aria-label="Matching story arcs">
                <SectionHeading
                  icon={<BookOpen className="h-4 w-4 text-ink-dim" />}
                  label="Story Arcs"
                  count={results.arcs.length}
                />
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {results.arcs.map((arc) => (
                    <ArcRow key={arc.slug} arc={arc} />
                  ))}
                </div>
              </section>
            )}

            {results.profiles.length > 0 && (
              <section aria-label="Matching detectives">
                <SectionHeading
                  icon={<Users className="h-4 w-4 text-ink-dim" />}
                  label="Detectives"
                  count={results.profiles.length}
                />
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {results.profiles.map((user) => (
                    <UserRow key={user.username} user={user} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
