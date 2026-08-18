import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function SettingsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b border-ink-dim/20 bg-surface/80 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <h1 className="font-display text-xl text-ink">Settings</h1>
          <p className="text-sm text-ink-dim mt-1">
            Manage your account preferences
          </p>
        </div>
      </div>
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-16">
        <section className="mb-16">
          <h2 className="font-display text-2xl font-bold text-ink">Settings</h2>
          <p className="text-sm text-ink-dim mt-2">
            Manage your account and preferences.
          </p>
        </section>
      </main>
    </div>
  )
}