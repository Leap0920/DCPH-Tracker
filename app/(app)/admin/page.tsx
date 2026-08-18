import Link from "next/link"
import { createClient } from "@/utils/supabase/server"
import { Film, Users, MessagesSquare, Image as ImageIcon, RefreshCw, BookOpen, ArrowRight } from "lucide-react"

export const dynamic = "force-dynamic"

async function getStats() {
  const supabase = await createClient()

  const [episodes, movies, otherContent, users, messages, missingCovers, arcs] = await Promise.all([
    supabase.from("content_entries").select("*", { count: "exact", head: true }).eq("type", "episode"),
    supabase.from("content_entries").select("*", { count: "exact", head: true }).eq("type", "movie"),
    supabase
      .from("content_entries")
      .select("*", { count: "exact", head: true })
      .not("type", "in", "(episode,movie)"),
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("chat_messages").select("*", { count: "exact", head: true }),
    supabase.from("content_entries").select("*", { count: "exact", head: true }).is("image_url", null),
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

export default async function AdminOverviewPage() {
  const stats = await getStats()

  const cards = [
    { label: "Episodes", value: stats.episodes, icon: Film },
    { label: "Movies", value: stats.movies, icon: Film },
    { label: "Other content", value: stats.otherContent, icon: Film },
    { label: "Story Arcs", value: stats.arcs, icon: BookOpen },
    { label: "Users", value: stats.users, icon: Users },
    { label: "Chat messages", value: stats.messages, icon: MessagesSquare },
    { label: "Missing covers", value: stats.missingCovers, icon: ImageIcon, warn: stats.missingCovers > 0 },
  ]

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-display text-sm tracking-tight text-ink-dim mb-4">
          At a glance
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => {
            const Icon = c.icon
            return (
              <div
                key={c.label}
                className="rounded-lg border border-ink-dim/20 bg-surface p-5 shadow-card"
              >
                <div className="flex items-center gap-2 text-ink-faint mb-2">
                  <Icon className="h-4 w-4" />
                  <span className="font-mono text-[10px]">
                    {c.label}
                  </span>
                </div>
                <div
                  className={
                    "font-display text-3xl " +
                    (c.warn ? "text-red-400" : "text-ink")
                  }
                >
                  {c.value}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="font-display text-sm tracking-tight text-ink-dim mb-4">
          Quick actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <QuickLink
            href="/admin/content/covers"
            title="Missing Covers Panel"
            desc="Fix missing poster artwork directly from a queue."
            icon={ImageIcon}
          />
          <QuickLink
            href="/admin/arcs"
            title="Manage Story Arcs"
            desc="Group episodes into storyline arcs and sagas."
            icon={BookOpen}
          />
          <QuickLink
            href="/admin/content"
            title="Manage Content & Relocate"
            desc="Edit entry details and switch categories with one click."
            icon={Film}
          />
          <QuickLink
            href="/admin/users"
            title="Manage Users"
            desc="Promote/demote moderators and manage account status."
            icon={Users}
          />
          <QuickLink
            href="/admin/sync"
            title="Run API Sync"
            desc="Pull latest episode data from external APIs."
            icon={RefreshCw}
          />
        </div>
      </section>
    </div>
  )
}

function QuickLink({
  href,
  title,
  desc,
  icon: Icon,
}: {
  href: string
  title: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-lg border border-ink-dim/20 bg-surface p-5 shadow-card transition-colors hover:border-ink-dim/30 hover:bg-surface-muted"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-ink text-page shrink-0">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 font-display tracking-tight text-ink">
          {title}
          <ArrowRight className="h-4 w-4 opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
        </div>
        <p className="mt-0.5 text-sm text-ink-dim">{desc}</p>
      </div>
    </Link>
  )
}
