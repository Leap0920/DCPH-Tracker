"use client"

import { motion } from "framer-motion"
import { Calendar } from "lucide-react"
import ElegantCarousel from "@/components/ui/elegant-carousel"

const EASE = [0.16, 1, 0.3, 1] as const

export function FourYearsSection() {
  return (
    <section className="relative mx-auto max-w-6xl px-6 sm:px-12 lg:px-24">
      <div className="space-y-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="mb-1 inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-ink-faint">
              <Calendar className="h-3.5 w-3.5 text-accent" />
              SM North EDSA Cinema Highlights
            </div>
            <h3 className="font-display text-2xl font-bold text-ink sm:text-3xl">
              Four Years of Screenings
            </h3>
          </div>
          <p className="max-w-md text-xs text-ink-dim sm:text-sm">
            Watch video highlights and recaps of our annual DCPH cinema block screenings at SM North EDSA.
          </p>
        </div>

        {/* Elegant Carousel Component with Video Highlights */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <ElegantCarousel />
        </motion.div>
      </div>
    </section>
  )
}
