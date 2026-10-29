"use client"

import { motion, useReducedMotion } from "framer-motion"
import ElegantCarousel from "@/components/ui/elegant-carousel"

const EASE = [0.16, 1, 0.3, 1] as const

export function FiveYearsSection() {
  const reduce = useReducedMotion()

  return (
    <section className="relative mx-auto max-w-6xl px-6 sm:px-12">
      <div className="space-y-10 sm:space-y-12">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: EASE }}
          className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"
        >
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-faint sm:text-[11px]">
              Cinema highlights
            </span>
            <h3 className="mt-3 font-display text-[clamp(1.4rem,2.6vw,2rem)] font-medium tracking-[-0.02em] text-ink">
              Five years of screenings
            </h3>
          </div>
          <p className="max-w-[38ch] text-xs leading-relaxed text-ink-dim sm:text-sm">
            Recaps from our annual screenings at SM North EDSA.
          </p>
        </motion.div>

        {/* Elegant Carousel Component with Video Highlights */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 28, filter: "blur(8px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.8, ease: EASE }}
        >
          <ElegantCarousel />
        </motion.div>
      </div>
    </section>
  )
}
