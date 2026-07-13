"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, Shield, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"

export function HeroSection() {
  return (
    <section className="relative overflow-hidden px-6 py-24 sm:py-32">
      {/* Background glow */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[500px] w-[800px] bg-poison-red/10 blur-[120px] rounded-full" />
      </div>

      <div className="mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="case-number mb-4 inline-block">CLASSIFIED — LEVEL 5 CLEARANCE</span>

          <h1 className="font-display text-5xl sm:text-7xl uppercase tracking-wide text-dossier-cream mb-6">
            Detective Conan{" "}
            <span className="text-poison-red-bright">PH</span>
          </h1>

          <p className="font-body text-lg text-dossier-cream-dim max-w-2xl mx-auto mb-10">
            The Filipino community&apos;s case tracker. Log every episode, movie, and special.
            Climb the ranks. Prove your worth to the organization.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/tracker">
              <Button size="lg" className="gap-2">
                Open Case Files
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/community/rankings">
              <Button variant="outline" size="lg" className="gap-2">
                <Eye className="h-4 w-4" />
                View Rankings
              </Button>
            </Link>
          </div>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-20 grid grid-cols-3 gap-4 max-w-lg mx-auto"
        >
          {[
            { value: "1100+", label: "Episodes" },
            { value: "29", label: "Movies" },
            { value: "50+", label: "Specials" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="font-display text-2xl sm:text-3xl text-dossier-cream">
                {stat.value}
              </div>
              <div className="case-number mt-1">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
