"use client"

import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowRight, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { openAuthModal } from "@/lib/auth-modal"

const EASE = [0.16, 1, 0.3, 1] as const

/** Homepage CTA band — "Start Tracking" goes to the tracker, "Sign Up" opens
 *  the auth modal in signup mode (no page navigation). */
export function HomeCta() {
  const reduce = useReducedMotion()

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
          Ready to start tracking?
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-dim sm:text-base">
          Create a free account and pick up where Conan left off.
        </p>

        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <motion.div
            whileHover={reduce ? undefined : { scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <Link href="/tracker" className="sm:w-auto">
              <Button className="dcph-sheen group h-12 w-full gap-2 rounded-xl bg-accent px-7 font-display font-semibold text-white shadow-md transition-shadow hover:bg-accent-bright hover:shadow-glow sm:w-auto">
                Start Tracking
                <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
              </Button>
            </Link>
          </motion.div>

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
        </div>
      </motion.div>
    </section>
  )
}