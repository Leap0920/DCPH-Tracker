"use client"

import Link from "next/link"
import Image from "next/image"
import { motion, useReducedMotion, type Variants } from "framer-motion"
import { useEffect, useState } from "react"
import { openAuthModal } from "@/lib/auth-modal"
import { createClient } from "@/utils/supabase/client"
import { SectionHeading } from "./SectionHeading"

const EASE = [0.16, 1, 0.3, 1] as const

const stepListVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1, delayChildren: 0.15 },
  },
}

const stepVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.65, ease: EASE },
  },
}

export function HowItWorks() {
  const reduce = useReducedMotion()
  const supabase = createClient()

  // Step one is "create your account", which a signed-in visitor has already
  // done, so the step has to know the session. It is read in the browser for
  // the same reason as the CTA band: the homepage is statically rendered, and
  // reading cookies here would opt the whole marketing page out of that.
  // null = not resolved yet, which is treated as "do not offer sign-up".
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
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
    // Subscribe once for the life of the section; the browser client is rebuilt
    // per render by design (utils/supabase/client.ts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="mx-auto max-w-6xl px-6 sm:px-12">
      <SectionHeading eyebrow="How it works" title="From zero to full detective" />

      <div className="mt-12 flex flex-col gap-12 sm:mt-16 lg:flex-row lg:items-start lg:justify-between lg:gap-20">
        {/* Left: two overlapping stills. Kept because they are real characters
            from the show, not decoration standing in for a product shot. */}
        <motion.div
          initial={reduce ? false : { opacity: 0, x: -24 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: EASE }}
          className="relative h-[260px] w-full max-w-sm shrink-0 sm:h-[340px] sm:max-w-md"
        >
          <div className="absolute left-2 top-0 h-52 w-40 overflow-hidden rounded-xl border border-line sm:left-4 sm:h-64 sm:w-56">
            <Image
              src="/img/shinichi.jpg"
              alt="Shinichi Kudo"
              fill
              sizes="(max-width: 640px) 160px, 224px"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </div>

          <div className="absolute bottom-0 right-2 z-10 h-52 w-40 overflow-hidden rounded-xl border border-line sm:right-4 sm:h-64 sm:w-56">
            <Image
              src="/img/Jinpei.jpg"
              alt="Jinpei Matsuda"
              fill
              sizes="(max-width: 640px) 160px, 224px"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </div>
        </motion.div>

        {/* Right: three steps as a numbered ledger. Numbers replace the icon
            circles; the rule above each step does the separating. */}
        <motion.ol
          initial={reduce ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={stepListVariants}
          className="w-full max-w-xl"
        >
          {/* Step 1 */}
          <motion.li variants={stepVariants} className="border-t border-line py-6">
            <div className="flex items-baseline gap-5">
              <span className="font-mono text-[11px] tabular-nums text-ink-faint">01</span>
              <div>
                <h3 className="font-display text-base font-medium text-ink sm:text-lg">
                  {signedIn ? "Your account is ready" : "Create your account"}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-dim">
                  {signedIn
                    ? "Your progress is saved to this account."
                    : "Email only. Takes about a minute."}
                </p>
                {/* Signed-out visitors only, and only once the session is known:
                    an account that already exists has nothing to sign up for. */}
                {signedIn === false && (
                  <button
                    type="button"
                    onClick={() => openAuthModal("signup")}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-bright"
                  >
                    Create account
                  </button>
                )}
              </div>
            </div>
          </motion.li>

          {/* Step 2 */}
          <motion.li variants={stepVariants} className="border-t border-line py-6">
            <div className="flex items-baseline gap-5">
              <span className="font-mono text-[11px] tabular-nums text-ink-faint">02</span>
              <div>
                <h3 className="font-display text-base font-medium text-ink sm:text-lg">
                  Track what you watch
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-dim">
                  Episodes, movies, specials and OVAs, ticked off as you go.
                </p>
                <Link
                  href="/tracker"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-bright"
                >
                  Start tracking
                </Link>
              </div>
            </div>
          </motion.li>

          {/* Step 3 */}
          <motion.li variants={stepVariants} className="border-y border-line py-6">
            <div className="flex items-baseline gap-5">
              <span className="font-mono text-[11px] tabular-nums text-ink-faint">03</span>
              <div>
                <h3 className="font-display text-base font-medium text-ink sm:text-lg">
                  Compete with fellow detectives
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-dim">
                  Climb the rankings. Talk cases in the chat rooms.
                </p>
                <Link
                  href="/community/rankings"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-bright"
                >
                  See rankings
                </Link>
              </div>
            </div>
          </motion.li>
        </motion.ol>
      </div>
    </section>
  )
}
