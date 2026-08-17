"use client"

import Link from "next/link"
import { motion, useReducedMotion, type Variants } from "framer-motion"
import { UserPlus, ListChecks, Trophy, ArrowRight } from "lucide-react"
import { openAuthModal } from "@/lib/auth-modal"
import { SectionHeading } from "./SectionHeading"

const EASE = [0.16, 1, 0.3, 1] as const

const stepListVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1, delayChildren: 0.15 },
  },
}

const stepVariants: Variants = {
  hidden: { opacity: 0, y: 24, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: EASE },
  },
}

export function HowItWorks() {
  const reduce = useReducedMotion()

  return (
    <section className="mx-auto max-w-6xl px-6 sm:px-12">
      <SectionHeading
        eyebrow="How it works"
        title="From zero to full detective"
        subtitle="Three simple steps to start tracking, ranking, and chatting with the community."
      />

      <div className="mt-12 sm:mt-16 lg:mt-20 flex flex-col md:flex-row items-center justify-between gap-10 sm:gap-12 lg:gap-16">
        {/* Left Side: Overlapping stacked image cards (Shinichi and Jinpei) */}
        <motion.div
          initial={
            reduce
              ? false
              : { opacity: 0, x: -30, filter: "blur(6px)" }
          }
          whileInView={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.7, ease: EASE }}
          className="relative w-full max-w-sm sm:max-w-md h-[280px] sm:h-[380px] flex items-center justify-center"
        >
          {/* Background Image Card (Shinichi Kudo) */}
          <div className="absolute top-0 left-2 sm:left-4 w-44 sm:w-60 h-56 sm:h-72 overflow-hidden rounded-2xl sm:rounded-3xl border border-slate-200/80 shadow-lg -rotate-3 hover:rotate-0 transition-all duration-500">
            <img
              src="/img/shinichi.jpg"
              alt="Shinichi Kudo - Detective Conan"
              className="h-full w-full object-cover"
            />
          </div>

          {/* Foreground Image Card (Jinpei Matsuda) */}
          <div className="absolute bottom-0 right-2 sm:right-4 w-44 sm:w-60 h-56 sm:h-72 overflow-hidden rounded-2xl sm:rounded-3xl border-2 border-white shadow-2xl rotate-3 hover:rotate-0 transition-all duration-500 z-10">
            <img
              src="/img/Jinpei.jpg"
              alt="Jinpei Matsuda - Police Academy"
              className="h-full w-full object-cover"
            />
          </div>
        </motion.div>

        {/* Right Side: Vertical feature list with accent circle icons */}
        <motion.div
          initial={reduce ? "show" : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          variants={stepListVariants}
          className="space-y-8 sm:space-y-10 w-full max-w-lg"
        >
          {/* Step 1 */}
          <motion.div variants={stepVariants} className="flex items-start gap-4 sm:gap-6 group">
            <div className="p-3 sm:p-4 aspect-square bg-accent-soft text-accent rounded-full flex items-center justify-center shrink-0 shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:bg-accent group-hover:text-white">
              <UserPlus className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <div className="space-y-1 pt-0.5 sm:pt-1">
              <h3 className="text-base sm:text-lg font-semibold font-display text-ink">Create your account</h3>
              <p className="text-xs sm:text-sm text-ink-dim leading-relaxed">
                Sign up in under a minute with just an email, no credit card, no fuss.
              </p>
              <button
                type="button"
                onClick={() => openAuthModal("signup")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:gap-2 transition-all pt-1"
              >
                Create account <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>

          {/* Step 2 */}
          <motion.div variants={stepVariants} className="flex items-start gap-4 sm:gap-6 group">
            <div className="p-3 sm:p-4 aspect-square bg-accent-soft text-accent rounded-full flex items-center justify-center shrink-0 shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:bg-accent group-hover:text-white">
              <ListChecks className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <div className="space-y-1 pt-0.5 sm:pt-1">
              <h3 className="text-base sm:text-lg font-semibold font-display text-ink">Track what you watch</h3>
              <p className="text-xs sm:text-sm text-ink-dim leading-relaxed">
                Log every episode, movie, special and OVA as you go and watch your progress fill in.
              </p>
              <Link
                href="/tracker"
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:gap-2 transition-all pt-1"
              >
                Start tracking <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </motion.div>

          {/* Step 3 */}
          <motion.div variants={stepVariants} className="flex items-start gap-4 sm:gap-6 group">
            <div className="p-3 sm:p-4 aspect-square bg-accent-soft text-accent rounded-full flex items-center justify-center shrink-0 shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:bg-accent group-hover:text-white">
              <Trophy className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <div className="space-y-1 pt-0.5 sm:pt-1">
              <h3 className="text-base sm:text-lg font-semibold font-display text-ink">Compete with fellow detectives</h3>
              <p className="text-xs sm:text-sm text-ink-dim leading-relaxed">
                Climb the detective rankings and talk cases with the community in themed chat rooms.
              </p>
              <Link
                href="/community/rankings"
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:gap-2 transition-all pt-1"
              >
                See rankings <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
