"use client"

import { useRef, useState } from "react"
import {
  motion,
  AnimatePresence,
  useSpring,
  useMotionValue,
} from "framer-motion"
import {
  Film,
  Calendar,
  Sparkles,
  Maximize2,
  X,
  CheckCircle2,
  BellRing,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionHeading } from "./SectionHeading"
import ElegantCarousel from "@/components/ui/elegant-carousel"

const EASE = [0.16, 1, 0.3, 1] as const

export function BlockScreeningSection() {
  const [showPosterModal, setShowPosterModal] = useState(false)
  const [preRegistered, setPreRegistered] = useState(false)

  // 3D tilt for the 2026 promo poster
  const posterRef = useRef<HTMLDivElement>(null)
  const tiltX = useSpring(useMotionValue(0), { stiffness: 160, damping: 20 })
  const tiltY = useSpring(useMotionValue(0), { stiffness: 160, damping: 20 })

  const handlePosterMove = (e: React.MouseEvent) => {
    const rect = posterRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    tiltX.set(-py * 10)
    tiltY.set(px * 10)
  }

  const resetPosterTilt = () => {
    tiltX.set(0)
    tiltY.set(0)
  }

  return (
    <section className="relative overflow-hidden bg-page px-6 py-20 sm:px-12 lg:px-24">
      {/* Cinematic backdrop: soft rose glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-accent/5 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 h-96 w-96 rounded-full bg-accent/[0.04] blur-3xl"
      />

      <div className="relative mx-auto max-w-6xl space-y-16">
        {/* Section Header */}
        <SectionHeading
          eyebrow={
            <>
              <Sparkles className="h-3.5 w-3.5" />
              Annual Block Screenings
            </>
          }
          title="DCPH Annual Block Screenings"
          subtitle="Gathering Filipino Conan fans for grand cinema screenings at SM North EDSA with exclusive merch, cosplay, and unforgettable premieres."
        />

        {/* ============================================================== */}
        {/* UPCOMING 2026 BLOCK SCREENING PROMOTION CARD                   */}
        {/* ============================================================== */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.7, ease: EASE }}
          className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-card"
        >
          {/* Hover sheen sweep */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-1000 group-hover:translate-x-full"
          />

          <div className="grid items-center lg:grid-cols-12">
            {/* Left Promotion Poster (3D tilt) */}
            <div className="flex items-center justify-center overflow-hidden border-b border-slate-200 bg-black/5 p-4 lg:col-span-5 lg:border-b-0 lg:border-r lg:p-6 [perspective:1200px]">
              <motion.div
                ref={posterRef}
                onMouseMove={handlePosterMove}
                onMouseLeave={resetPosterTilt}
                style={{ rotateX: tiltX, rotateY: tiltY, transformStyle: "preserve-3d" }}
                whileHover={{ scale: 1.02 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
                className="relative w-full max-w-sm cursor-pointer overflow-hidden rounded-xl border border-slate-200/80 bg-slate-900 shadow-xl"
                onClick={() => setShowPosterModal(true)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/Bs2026.jpg"
                  alt="Detective Conan Movie 2026 Block Screening Promo"
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowPosterModal(true)
                  }}
                  className="absolute bottom-3 right-3 rounded-full bg-white/90 p-2 text-ink shadow-md transition-all hover:scale-110 hover:bg-white"
                  aria-label="View Full Poster"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>

                <span className="absolute left-3 top-3 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-wider text-white shadow">
                  SM North EDSA • 2026
                </span>
              </motion.div>
            </div>

            {/* Right Event Info & Call to Action */}
            <div className="space-y-6 p-6 sm:p-10 lg:col-span-7">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-amber-600">
                  <Film className="h-3.5 w-3.5" />
                  Movie 29 Cinema Event • SM North EDSA
                </div>
                <h3 className="font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
                  Detective Conan Movie 29: Block Screening 2026
                </h3>
                <p className="text-sm leading-relaxed text-ink-dim sm:text-base">
                  Watch Movie 29 with fellow fans at SM North EDSA, featuring exclusive DCPH merch, raffle prizes, and special giveaways.
                </p>
              </div>

              {/* Event Highlights */}
              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <div className="flex items-start gap-2.5 text-xs text-ink-dim sm:text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>Exclusive DCPH commemorative fan kit</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-ink-dim sm:text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>Raffles, cosplay & fan gathering</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-ink-dim sm:text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>Full HD cinema surround experience</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-ink-dim sm:text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>Official movie postcards & badges</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4">
                <Button
                  onClick={() => setPreRegistered(true)}
                  disabled={preRegistered}
                  className="h-11 gap-2 rounded-xl bg-accent px-6 font-display font-semibold text-white shadow-md transition-all hover:scale-[1.02] hover:bg-accent-bright disabled:opacity-100"
                >
                  {preRegistered ? (
                    <motion.span
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 18 }}
                      className="inline-flex items-center gap-2"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Pre-Registered!
                    </motion.span>
                  ) : (
                    <>
                      <BellRing className="h-4 w-4" />
                      Get 2026 Ticket Notification
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  onClick={() => setShowPosterModal(true)}
                  className="h-11 rounded-xl border-slate-200 px-5 font-display text-ink-dim hover:text-ink"
                >
                  View Promo Poster
                </Button>
              </div>

              <AnimatePresence>
                {preRegistered && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                    className="flex items-center gap-1.5 pt-1 font-mono text-xs text-green-600"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    You&apos;ll be notified as soon as ticket reservations open for the SM North EDSA Block Screening!
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* ============================================================== */}
        {/* BLOCK SCREENING HISTORY & ELEGANT CAROUSEL                     */}
        {/* ============================================================== */}
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
      </div>

      {/* ============================================================== */}
      {/* PROMO POSTER MODAL                                             */}
      {/* ============================================================== */}
      <AnimatePresence>
        {showPosterModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            onClick={() => setShowPosterModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="relative max-w-lg w-full overflow-hidden rounded-2xl border border-white/20 bg-black shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setShowPosterModal(false)}
                aria-label="Close poster modal"
                className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black"
              >
                <X className="h-5 w-5" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/Bs2026.jpg"
                alt="Detective Conan 2026 Block Screening Promo Poster"
                className="mx-auto h-auto max-h-[85vh] w-full object-contain"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}