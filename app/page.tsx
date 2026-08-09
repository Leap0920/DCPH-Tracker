import Link from "next/link"
import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"
import { HeroSection } from "@/components/marketing/HeroSection"
import { Button } from "@/components/ui/button"
import { BookOpen, Trophy, MessagesSquare, ListChecks } from "lucide-react"

export const metadata = {
  title: "Detective Conan PH — Track, Chat, and Climb the Ranks",
  description:
    "The Filipino Detective Conan community: track every episode, explore the story arcs, join the community chat, and prove your rank.",
}

const features = [
  {
    icon: ListChecks,
    title: "Track Episodes",
    body: "Log every case you watch — episodes, movies, specials and more — and watch your progress fill in.",
    href: "/tracker",
  },
  {
    icon: BookOpen,
    title: "Story Arcs",
    body: "Follow the main plot from Season 1 to the latest era with a clean guide and watch order.",
    href: "/arcs",
  },
  {
    icon: Trophy,
    title: "Agent Rankings",
    body: "See how many episodes fellow agents have cracked and climb the leaderboard yourself.",
    href: "/community/rankings",
  },
  {
    icon: MessagesSquare,
    title: "Community Chat",
    body: "Drop into themed rooms, talk cases, and connect with other detectives.",
    href: "/community/chat",
  },
]

export default function HomePage() {
  return (
    <div className="bg-page text-ink flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <HeroSection />

        <section className="mx-auto max-w-5xl px-6 pb-20">
          <h2 className="font-display text-2xl sm:text-3xl text-ink text-center">
            What you can do
          </h2>
          <p className="mt-2 text-center text-ink-dim max-w-xl mx-auto">
            Everything you need to follow the case, all in one place.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => {
              const Icon = f.icon
              return (
                <Link
                  key={f.href}
                  href={f.href}
                  className="group rounded-lg border border-slate-200 bg-surface p-6 shadow-card transition-colors hover:border-slate-300 hover:bg-surface-muted"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-lg text-ink">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm text-ink-dim">{f.body}</p>
                </Link>
              )
            })}
          </div>

          <div className="mt-12 rounded-lg border border-slate-200 bg-surface-muted p-8 text-center">
            <h3 className="font-display text-xl text-ink">
              Ready to start tracking?
            </h3>
            <p className="mt-2 text-sm text-ink-dim">
              Create a free account and pick up where Conan left off.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <Link href="/tracker">
                <Button className="rounded-lg">Start Tracking</Button>
              </Link>
              <Link href="/signup">
                <Button variant="outline" className="rounded-lg border-slate-200">
                  Sign Up
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
