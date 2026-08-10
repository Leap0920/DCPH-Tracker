"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { openAuthModal } from "@/lib/auth-modal"

/** Homepage CTA band — "Start Tracking" goes to the tracker, "Sign Up" opens
 *  the auth modal in signup mode (no page navigation). */
export function HomeCta() {
  return (
    <div className="border-t border-slate-200/70">
      <section className="mx-auto max-w-5xl px-6 py-16 text-center">
        <h3 className="font-display text-xl sm:text-2xl text-ink">
          Ready to start tracking?
        </h3>
        <p className="mt-2 text-sm text-ink-dim">
          Create a free account and pick up where Conan left off.
        </p>
        <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Link href="/tracker" className="sm:w-auto">
            <Button className="h-11 w-full rounded-lg">Start Tracking</Button>
          </Link>
          <Button
            variant="outline"
            onClick={() => openAuthModal("signup")}
            className="h-11 w-full rounded-lg border-slate-200 sm:w-auto"
          >
            Sign Up
          </Button>
        </div>
      </section>
    </div>
  )
}
