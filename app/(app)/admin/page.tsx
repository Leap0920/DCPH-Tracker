import Link from "next/link"
import { createClient } from "@/utils/supabase/server"
import {
  Film,
  Users,
  MessagesSquare,
  Image as ImageIcon,
  RefreshCw,
  BookOpen,
  ChevronRight,
} from "lucide-react"

export const dynamic = "force-dynamic"

async function getStats() {
  const supabase = await createClient()

  const [episodes, movies, otherContent, users, messages, missingCovers, arcs] =
    await Promise.all([
      supabase
        .from("content_entries")
        .select("*", { count: "exact", head: true })
        .eq("type", "episode"),
      supabase
        .from("content_entries")
        .select("*", { count: "exact", head: true })
        .eq("type", "movie"),
      supabase
        .from("content_entries")
        .select("*", { count: "exact", head: true })
        .not("type", "in", "(episode,movie)"),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("chat_messages").select("*", { count: "exact", head: true }),
      supabase
        .from("content_entries")
        .select("*", { count: "exact", head: true })
        .is("image_url", null),
      supabase.from("arcs").select("*", { count: "exact", head: true }),
    ])

  return {
    episodes: episodes.count ?? 0,
    movies: movies.count ?? 0,
    otherContent: otherContent.count ?? 0,
    users: users.count ?? 0,
    messages: messages.count ?? 0,
    missingCovers: missingCovers.count ?? 0,
    arcs: arcs.count ?? 0,
  }
}

const nf = new Intl.NumberFormat("en-US")

export default async function AdminOverviewPage() {
  const stats = await getStats()

  const cards = [
    { label: "Episodes", value: stats.episodes, icon: Film },
    { label: "Movies", value: stats.movies, icon: Film },
    { label: "Other content", value: stats.otherContent, icon: Film },
    { label: "Story arcs", value: stats.arcs, icon: BookOpen },
    { label: "Users", value: stats.users, icon: Users },
    { label: "Chat messages", value: stats.messages, icon: MessagesSquare },
    {
      label: "Missing covers",
      value: stats.missingCovers,
      icon: ImageIcon,
      warn: stats.missingCovers > 0,
      hint: stats.missingCovers > 0 ? "Needs attention" : "All clear",
      href: "/admin/content/covers",
    },
  ]

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <h1 className="font-display text-xl tracking-tight text-ink">Overview</h1>
        <p className="text-[13px] text-ink-dim">
          Catalog health and shortcuts for the most common admin tasks.
        </p>
      </header>

      <section aria-labelledby="stats-heading">
        <h2
          id="stats-heading"
          className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint"
        >
          At a glance
        </h2>

        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((c, i) => {
            const Icon = c.icon
            const body = (
              <>
                <div className="mb-3 flex items-center gap-2 text-ink-faint">
                  <Icon className="h-3.5 w-3.5" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em]">
                    {c.label}
                  </span>
                </div>
                <div
                  className={
                    "font-display text-[26px] leading-none tracking-tight tabular-nums " +
                    (c.warn ? "text-warning" : "text-ink")
                  }
                >
                  {nf.format(c.value)}
                </div>
                {c.hint ? (
                  <div className="mt-2 font-mono text-[10px] text-ink-faint">
                    {c.hint}
                  </div>
                ) : null}
              </>
            )

            const cellClass = [
              "relative p-4 sm:p-5",
              // hairline separators without doubling on the outer edge
              "border-line",
              i % 2 === 1 ? "border-l" : "",
              "sm:border-l-0 sm:[&:not(:nth-child(3n+1))]:border-l",
              "lg:border-l-0 lg:[&:not(:nth-child(4n+1))]:border-l",
              "[&:nth-child(n+3)]:border-t",
              "sm:[&:nth-child(n+3)]:border-t-0 sm:[&:nth-child(n+4)]:border-t",
              "lg:[&:nth-child(n+4)]:border-t-0 lg:[&:nth-child(n+5)]:border-t",
            ].join(" ")

            return c.href ? (
              <Link
                key={c.label}
                href={c.href}
                className={
                  cellClass +
                  " transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/40"
                }
              >
                {body}
              </Link>
            ) : (
              <div key={c.label} className={cellClass}>
                {body}
              </div>
            )
          })}
        </div>
      </section>

      <section aria-labelledby="actions-heading">
        <h2
          id="actions-heading"
          className="mb-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint"
        >
          Quick actions
        </h2>

        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
          <QuickLink
            href="/admin/content/covers"
            title="Missing covers"
            desc="Fix missing poster artwork from a focused queue."
            icon={ImageIcon}
            meta={stats.missingCovers > 0 ? `${stats.missingCovers} pending` : undefined}
          />
          <QuickLink
            href="/admin/arcs"
            title="Story arcs"
            desc="Group episodes into storyline arcs and sagas."
            icon={BookOpen}
          />
          <QuickLink
            href="/admin/content"
            title="Content & relocate"
            desc="Edit entry details and switch categories in one click."
            icon={Film}
          />
          <QuickLink
            href="/admin/users"
            title="Users"
            desc="Promote or demote moderators and manage accounts."
            icon={Users}
          />
          <QuickLink
            href="/admin/sync"
            title="API sync"
            desc="Pull the latest episode data from external sources."
            icon={RefreshCw}
          />
        </ul>
      </section>
    </div>
  )
}

function QuickLink({
  href,
  title,
  desc,
  meta,
  icon: Icon,
}: {
  href: string
  title: string
  desc: string
  meta?: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/40"
      >
        <Icon className="h-4 w-4 shrink-0 text-ink-faint transition-colors group-hover:text-ink" />

        <div className="min-w-0 flex-1">
          <div className="font-display text-[13px] tracking-tight text-ink">
            {title}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-ink-dim">{desc}</p>
        </div>

        {meta ? (
          <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ink-dim">
            {meta}
          </span>
        ) : null}

        <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
    </li>
  )
}
