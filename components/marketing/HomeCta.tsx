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
      {/* Soft cinematic glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-accent/[0.06] blur-3xl"
      />

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.6, ease: EASE }}
        className="relative"
      >
        <h3 className="font-display text-2xl font-bold text-ink sm:text-3xl">
          Ready to start tracking?
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-dim sm:text-base">
          Create a free account and pick up where Conan left off.
        </p>

        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <motion.div
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <Link href="/tracker" className="sm:w-auto">
              <Button className="h-12 w-full gap-2 rounded-xl bg-accent px-7 font-display font-semibold text-white shadow-md hover:bg-accent-bright sm:w-auto">
                Start Tracking
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </motion.div>

          <motion.div
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
          >
            <Button
              variant="outline"
              onClick={() => openAuthModal("signup")}
              className="h-12 w-full gap-2 rounded-xl border-ink-dim/20 px-7 font-display text-ink-dim hover:text-ink sm:w-auto"
            >
              <UserPlus className="h-4 w-4" />
              Sign Up
            </Button>
          </motion.div>
        </div>
      </motion.div>
    </section>
  )
}