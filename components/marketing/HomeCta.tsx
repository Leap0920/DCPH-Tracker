"use client"

import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowRight, UserPlus } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { openAuthModal } from "@/lib/auth-modal"
import { createClient } from "@/utils/supabase/client"

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * Homepage CTA band — "Start Tracking" goes to the tracker, "Sign Up" opens
 * the auth modal in signup mode (no page navigation).
 *
 * The band resolves the session in the browser instead of on the server: the
 * homepage is statically rendered (`revalidate = 300` in app/page.tsx), and
 * reading cookies here would opt the whole marketing page out of that. Sign Up
 * is rendered only for a *confirmed* signed-out visitor, so a signed-in user
 * never sees it — not even for a frame while the session resolves.
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
    <section className="relative mx-auto max-w-5xl overflow-hidden px-6 py-20 text-center sm:px-12 sm:py-24">
      {/* Layered cinematic glow — two blobs drifting on opposing cycles so the
          band never looks static, at a low enough opacity to stay quiet. */}
      <div
        aria-hidden
        className="dcph-drift-slow pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-accent/[0.07] blur-3xl"
      />
      <div
        aria-hidden
        className="dcph-drift-slower pointer-events-none absolute bottom-0 left-[18%] h-52 w-52 rounded-full bg-gold-seal/[0.05] blur-3xl"
      />

      {/* Hairline frame that draws in from the centre. */}
      <motion.span
        aria-hidden
        initial={reduce ? false : { scaleX: 0, opacity: 0 }}
        whileInView={{ scaleX: 1, opacity: 1 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.9, ease: EASE }}
        className="pointer-events-none absolute inset-x-6 top-8 h-px origin-center bg-gradient-to-r from-transparent via-ink-dim/25 to-transparent sm:inset-x-12"
      />

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.6, ease: EASE }}
        className="relative"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-soft px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-accent">
          Case open
        </span>

        <h3 className="mt-5 font-display text-2xl font-bold text-ink sm:text-3xl">
          Open your case file.
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-dim sm:text-base">
          {signedIn
            ? "Pick up where you left off."
            : "Free to join. Start at episode one."}
        </p>

        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <motion.div
            whileHover={reduce ? undefined : { scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <Link href="/tracker" className="sm:w-auto">
              <Button className="dcph-sheen group h-12 w-full gap-2 rounded-xl bg-accent px-7 font-display font-semibold text-white shadow-md transition-shadow hover:bg-accent-bright hover:shadow-glow sm:w-auto">
                {signedIn ? "Continue tracking" : "Start Tracking"}
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
            </Link>
          </motion.div>

          {/* Signed-out visitors only: an account that already exists has nothing
              to sign up for. Gated on `=== false` rather than `!signedIn` so it
              never renders while the session is still unknown. */}
          {signedIn === false && (
            <motion.div
              whileHover={reduce ? undefined : { scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
              <Button
                variant="outline"
                onClick={() => openAuthModal("signup")}
                className="group h-12 w-full gap-2 rounded-xl border-ink-dim/20 px-7 font-display text-ink-dim transition-colors hover:border-accent/40 hover:text-ink sm:w-auto"
              >
                <UserPlus className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5" />
                Sign Up
              </Button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </section>
  )
}
