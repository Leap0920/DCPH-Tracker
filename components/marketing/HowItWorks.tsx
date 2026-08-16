"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { UserPlus, ListChecks, Trophy, ArrowRight } from "lucide-react"
import { openAuthModal } from "@/lib/auth-modal"
import { SectionHeading } from "./SectionHeading"

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-10">
      <SectionHeading
        eyebrow="How it works"
        title="From zero to full detective"
        subtitle="Three simple steps to start tracking, ranking, and chatting with the community."
      />

      <div className="mt-8 sm:mt-12 flex flex-col md:flex-row items-center justify-between gap-8 sm:gap-12 lg:gap-16">
        {/* Left Side: Overlapping stacked image cards (Shinichi and Jinpei) */}
        <motion.div 
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
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

        {/* Right Side: Vertical feature list with colored circle icons */}
        <motion.div 
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-6 sm:space-y-8 w-full max-w-lg"
        >
          {/* Step 1 */}
          <div className="flex items-start gap-4 sm:gap-6 group">
            <div className="p-3 sm:p-4 aspect-square bg-violet-100 rounded-full flex items-center justify-center text-violet-600 shrink-0 shadow-sm transition-transform group-hover:scale-110">
              <UserPlus className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <div className="space-y-1 pt-0.5 sm:pt-1">
              <h3 className="text-base sm:text-lg font-semibold font-display text-ink">Create your account</h3>
              <p className="text-xs sm:text-sm text-ink-dim leading-relaxed">
                Sign up in under a minute with just an email — no credit card, no fuss.
              </p>
              <button
                type="button"
                onClick={() => openAuthModal("signup")}
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:gap-2 transition-all pt-1"
              >
                Create account <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex items-start gap-4 sm:gap-6 group">
            <div className="p-3 sm:p-4 aspect-square bg-green-100 rounded-full flex items-center justify-center text-green-600 shrink-0 shadow-sm transition-transform group-hover:scale-110">
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
          </div>

          {/* Step 3 */}
          <div className="flex items-start gap-4 sm:gap-6 group">
            <div className="p-3 sm:p-4 aspect-square bg-orange-100 rounded-full flex items-center justify-center text-orange-600 shrink-0 shadow-sm transition-transform group-hover:scale-110">
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
          </div>
        </motion.div>
      </div>
    </section>
  )
}