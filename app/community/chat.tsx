import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function CommunityChatPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b border-slate-200 bg-surface/80 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <h1 className="font-display text-xl text-ink">Community Chat</h1>
          <p className="text-sm text-ink-dim mt-1">
            Drop into themed rooms, talk cases, and connect with other detectives
          </p>
        </div>
      </div>
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-16">
        <section className="mb-16">
          <h2 className="font-display text-2xl font-bold text-ink">Chat Rooms</h2>
          <p className="text-sm text-ink-dim mt-2">
            Join themed rooms, talk cases, and connect with other detectives.
          </p>
        </section>
      </main>
    </div>
  )
}