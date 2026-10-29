"use client"

import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { openAuthModal } from "@/lib/auth-modal"
import { createClient } from "@/utils/supabase/client"

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * Homepage CTA band. "Start tracking" goes to the tracker, "Sign up" opens the
 * auth modal in signup mode (no page navigation).
 *
 * The band resolves the session in the browser instead of on the server: the
 * homepage is statically rendered (`revalidate = 300` in app/page.tsx), and
 * reading cookies here would opt the whole marketing page out of that. Sign Up
 * is rendered only for a *confirmed* signed-out visitor, so a signed-in user
 * never sees it, not even for a frame while the session resolves.
 *
 * Laid out left-aligned on a hairline rather than centred on a badge: the
 * closing band is the last thing on the page and does not need a pill to
 * announce itself.
 */
export function HomeCta() {
  const reduce = useReducedMotion()
  const supabase = createClient()

  // null = the session has not resolved yet (SSR and the first paint).
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    // getSession() reads the stored session locally, so a page that otherwise
    // makes no auth request does not gain one. onAuthStateChange keeps the band
    // correct across sign-in and sign-out without a reload.
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session))
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session))
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
    // Subscribe once for the life of the band; the browser client is rebuilt per
    // render by design (utils/supabase/client.ts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="relative mx-auto max-w-6xl px-6 py-20 sm:px-12 sm:py-28">
      {/* One soft light source, low enough to read as depth rather than glow. */}
      <div
        aria-hidden
        className="dcph-drift-slow pointer-events-none absolute right-0 top-10 h-64 w-64 rounded-full bg-accent/[0.06] blur-3xl"
      />

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.7, ease: EASE }}
        className="relative border-t border-line pt-10 sm:pt-14"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-faint sm:text-[11px]">
          Case open
        </span>

        <h2 className="mt-4 max-w-[18ch] font-display text-[clamp(1.75rem,4vw,3rem)] font-medium leading-[1.04] tracking-[-0.02em] text-ink">
          Open your case file.
        </h2>
        <p className="mt-3 max-w-[40ch] text-sm leading-relaxed text-ink-dim sm:text-base">
          {signedIn
            ? "Pick up where you left off."
            : "Free to join. Start at episode one."}
        </p>

        <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <Link href="/tracker">
            <Button className="group h-12 gap-2 rounded-full bg-accent px-7 font-display text-sm font-medium text-white transition-colors hover:bg-accent-bright">
              {signedIn ? "Continue tracking" : "Start tracking"}
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Button>
          </Link>

          {/* Signed-out visitors only: an account that already exists has nothing
              to sign up for. Gated on `=== false` rather than `!signedIn` so it
              never renders while the session is still unknown. */}
          {signedIn === false && (
            <button
              type="button"
              onClick={() => openAuthModal("signup")}
              className="h-12 rounded-full border border-line px-6 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-dim transition-colors hover:border-accent/40 hover:text-ink"
            >
              Sign up
            </button>
          )}
        </div>
      </motion.div>
    </section>
  )
}
