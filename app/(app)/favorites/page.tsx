import Link from "next/link"
import Image from "next/image"
import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getUserFavorites, type FavoriteEntry } from "@/lib/queries/favorites"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { typeBadgeClass } from "@/lib/badges"
import { padNumber } from "@/lib/utils"
import { cn } from "@/lib/utils"

export const metadata = {
  title: "Favorites · Detective Conan PH",
  description: "Your locked favorite episodes and movies.",
}

function FavoriteCard({ entry }: { entry: FavoriteEntry }) {
  const displayNumber =
    entry.type === "movie"
      ? "MOVIE"
      : entry.type === "episode"
        ? `EP ${padNumber(entry.episode_number ?? 0)}`
        : entry.type.toUpperCase()

  return (
    <div className="relative bg-surface border border-line rounded-lg overflow-hidden group transition-all hover:border-ink-faint/40 hover:shadow-card">
      {entry.type !== "movie" && (
        <span className="absolute top-2 right-2 z-10 bg-ink text-page text-[10px] font-mono px-2 py-0.5 rounded-md">
          {displayNumber}
        </span>
      )}

      <div className="relative aspect-[3/2] bg-surface-muted overflow-hidden">
        {entry.image_url ? (
          <Image
            src={entry.image_url}
            alt={entry.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="font-display text-4xl text-ink-dim/15 uppercase">
              {displayNumber}
            </span>
          </div>
        )}
      </div>

      <div className="p-4">
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-mono",
            typeBadgeClass[entry.type] ?? typeBadgeClass.episode
          )}
        >
          {CONTENT_TYPE_LABELS[entry.type as ContentType]}
        </span>

        <Link href={`/tracker/${entry.slug}`}>
          <h3 className="mt-2.5 font-display text-sm tracking-tight text-ink group-hover:text-ink-dim transition-colors line-clamp-2">
            {entry.title}
          </h3>
        </Link>

        {entry.synopsis && (
          <p className="mt-2 text-xs text-ink-dim line-clamp-2">{entry.synopsis}</p>
        )}
      </div>
    </div>
  )
}

export default async function FavoritesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/?auth=signin")
  }

  const favorites = await getUserFavorites(user.id)

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FAVORITES · THE EVIDENCE LOCKER</span>
          <span className="redacted-bar w-16" />
        </div>

        <h1 className="font-display text-3xl sm:text-4xl tracking-tight text-ink">
          Favorites
        </h1>
        <p className="mt-2 max-w-xl text-ink-dim">
          Every case you hearted on the tracker, filed away for quick retrieval.
        </p>

        {favorites.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-line bg-surface-muted p-10 text-center">
            <p className="font-display text-lg tracking-tight text-ink">
              No favorites yet
            </p>
            <p className="mt-1 text-sm text-ink-dim">
              Heart episodes in the tracker and they&apos;ll show up here.
            </p>
            <Link
              href="/tracker"
              className="mt-5 inline-flex items-center rounded-md border border-line bg-surface px-4 py-2 text-xs font-mono text-ink-faint transition-colors hover:border-ink hover:text-ink"
            >
              OPEN THE TRACKER
            </Link>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {favorites.map((entry) => (
              <FavoriteCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
