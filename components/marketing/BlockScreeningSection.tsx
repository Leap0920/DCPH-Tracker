"use client"

import { useEffect, useRef, useState } from "react"
import {
  motion,
  AnimatePresence,
  useInView,
  animate,
  useMotionValue,
  useSpring,
} from "framer-motion"
import {
  Play,
  Film,
  Calendar,
  Users,
  Sparkles,
  Maximize2,
  X,
  CheckCircle2,
  BellRing,
  Award,
  VideoOff,
  MapPin,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionHeading } from "./SectionHeading"

const EASE = [0.16, 1, 0.3, 1] as const

interface BlockScreeningEvent {
  year: string
  movieTitle: string
  movieNum: string
  videoUrl?: string | null
  attendees: string
  venue: string
  description: string
  isPhotoOnly?: boolean
}

const BLOCK_SCREENING_EVENTS: BlockScreeningEvent[] = [
  {
    year: "2025",
    movieTitle: "Movie 28: One-eyed Flashback",
    movieNum: "Movie 28",
    videoUrl: "/videos/BS2025.mp4",
    attendees: "500+ Fans",
    venue: "SM Cinema / Ayala Malls",
    description: "Our 4th annual nationwide block screening! Hundreds of Filipino Conan detectives gathered for Movie 28.",
  },
  {
    year: "2024",
    movieTitle: "Movie 27: The Million-dollar Pentagram",
    movieNum: "Movie 27",
    videoUrl: "/videos/BS2024.mp4",
    attendees: "450+ Fans",
    venue: "Robinsons Movie World",
    description: "Sold-out cinema halls, Kid vs. Heiji hype, and exclusive DCPH commemorative fan kits for everyone.",
  },
  {
    year: "2023",
    movieTitle: "Movie 26: Black Iron Submarine",
    movieNum: "Movie 26",
    videoUrl: "/videos/BS2023.mp4",
    attendees: "400+ Fans",
    venue: "SM Megamall Cinema",
    description: "Full cinema takeover for Black Iron Submarine with cosplay meetups and official giveaway kits.",
  },
  {
    year: "2022",
    movieTitle: "Movie 25: The Bride of Halloween",
    movieNum: "Movie 25",
    videoUrl: null,
    isPhotoOnly: true,
    attendees: "250+ Fans",
    venue: "Metro Manila Cinema",
    description: "The 1st Inaugural DCPH Block Screening that launched our annual fan cinema tradition 4 years ago!",
  },
]

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
}

const cardVariants = {
  hidden: { opacity: 0, y: 32 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE },
  },
}

/** Count-up number that starts when it scrolls into view. */
function Counter({
  to,
  suffix = "",
  format = false,
}: {
  to: number
  suffix?: string
  format?: boolean
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const inView = useInView(ref, { once: true, margin: "-40px" })
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!inView) return
    const controls = animate(0, to, {
      duration: 1.4,
      ease: EASE,
      onUpdate: (v) => setValue(Math.round(v)),
    })
    return () => controls.stop()
  }, [inView, to])

  const display = format ? value.toLocaleString("en-US") : String(value)

  return (
    <p ref={ref} className="font-display text-3xl font-bold text-ink">
      {display}
      {suffix}
    </p>
  )
}

export function BlockScreeningSection() {
  const [activeVideo, setActiveVideo] = useState<BlockScreeningEvent | null>(null)
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
              4 Years of Block Screenings
            </>
          }
          title="DCPH Annual Block Screenings"
          subtitle="Since 2022, hundreds of Filipino Conan fans have gathered for grand cinema screenings, exclusive merch, cosplay, and unforgettable premieres."
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
                  5th Annual • 2026
                </span>
              </motion.div>
            </div>

            {/* Right Event Info & Call to Action */}
            <div className="space-y-6 p-6 sm:p-10 lg:col-span-7">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-amber-600">
                  <Film className="h-3.5 w-3.5" />
                  Movie 29 Cinema Event
                </div>
                <h3 className="font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">
                  Detective Conan Movie 29: Block Screening 2026
                </h3>
                <p className="text-sm leading-relaxed text-ink-dim sm:text-base">
                  Our 5th annual cinema gathering. Watch Movie 29 with fellow fans,
                  with exclusive DCPH merch, raffle prizes, and special giveaways.
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
                    You&apos;ll be notified as soon as ticket reservations open for the 2026 Block Screening!
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* ============================================================== */}
        {/* BLOCK SCREENING HISTORY & HIGHLIGHTS ARCHIVE (2022 - 2025)     */}
        {/* ============================================================== */}
        <div className="space-y-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="mb-1 inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-ink-faint">
                <Calendar className="h-3.5 w-3.5 text-accent" />
                4-Year Event History (2022 - 2025)
              </div>
              <h3 className="font-display text-2xl font-bold text-ink sm:text-3xl">
                Four Years of Screenings
              </h3>
            </div>
            <p className="max-w-md text-xs text-ink-dim sm:text-sm">
              Watch video recaps of our 2023, 2024, and 2025 events, plus our inaugural 2022 event that launched the tradition!
            </p>
          </div>

          {/* Event Cards Grid */}
          <motion.div
            variants={gridVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4"
          >
            {BLOCK_SCREENING_EVENTS.map((item) => (
              <motion.div
                key={item.year}
                variants={cardVariants}
                whileHover={{ y: -6 }}
                transition={{ type: "spring", stiffness: 300, damping: 22 }}
                className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-card"
              >
                {/* Media Container */}
                <div className="relative aspect-video overflow-hidden bg-slate-900">
                  {item.videoUrl ? (
                    <>
                      <video
                        src={item.videoUrl}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover opacity-80 transition-all duration-500 group-hover:scale-105 group-hover:opacity-100"
                      />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                      {/* Play Button Overlay */}
                      <button
                        type="button"
                        onClick={() => setActiveVideo(item)}
                        className="absolute inset-0 flex items-center justify-center transition-transform duration-300 group-hover:scale-110"
                        aria-label={`Play ${item.movieTitle} highlight video`}
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-accent shadow-lg transition-colors duration-300 group-hover:bg-accent group-hover:text-white">
                          <Play className="ml-0.5 h-5 w-5 fill-current" />
                        </div>
                      </button>
                    </>
                  ) : (
                    /* 2022 Inaugural Photo Card Display */
                    <div className="relative flex h-full w-full flex-col items-center justify-center space-y-2 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4 text-center">
                      <Award className="h-8 w-8 animate-pulse text-amber-400" />
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                        1st Inaugural Event
                      </span>
                      <p className="text-[11px] font-medium leading-tight text-slate-300">
                        Launched our DCPH Block Screening Tradition
                      </p>
                    </div>
                  )}

                  {/* Year Tag */}
                  <span className="absolute left-2.5 top-2.5 rounded-md bg-accent px-2 py-0.5 font-mono text-xs font-bold text-white shadow">
                    {item.year}
                  </span>

                  <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between font-mono text-[11px] text-white">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {item.attendees}
                    </span>
                    <span className="text-white/80">{item.movieNum}</span>
                  </div>
                </div>

                {/* Card Text Info */}
                <div className="flex flex-1 flex-col justify-between space-y-2.5 p-4">
                  <div className="space-y-1">
                    <h4 className="font-display text-sm font-bold text-ink transition-colors group-hover:text-accent">
                      {item.movieTitle}
                    </h4>
                    <p className="line-clamp-2 text-xs leading-relaxed text-ink-dim">
                      {item.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                    <span className="flex items-center gap-1 truncate font-mono text-[10px] text-ink-faint">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate max-w-[110px]">{item.venue}</span>
                    </span>
                    {item.videoUrl ? (
                      <button
                        type="button"
                        onClick={() => setActiveVideo(item)}
                        className="inline-flex shrink-0 items-center gap-1 font-display text-xs font-semibold text-accent transition-transform hover:translate-x-0.5 hover:underline"
                      >
                        Watch Recap &rarr;
                      </button>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-ink-faint">
                        <VideoOff className="h-3 w-3" /> No Video
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>

        {/* Stats Row */}
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          variants={gridVariants}
          className="grid grid-cols-2 gap-4 pt-4 lg:grid-cols-4"
        >
          {[
            { value: 4, suffix: "", label: "Annual Cinema Screenings (2022-2025)" },
            { value: 1600, suffix: "+", format: true, label: "Filipino Fans Attended" },
            { value: 100, suffix: "%", label: "Exclusive DCPH Fan Freebies" },
            { value: 5, suffix: "", label: "Major Cinema Screenings" },
          ].map((stat) => (
            <motion.div
              key={stat.label}
              variants={cardVariants}
              className="rounded-xl border border-slate-200/80 bg-surface p-5 text-center shadow-sm"
            >
              <Counter to={stat.value} suffix={stat.suffix} format={stat.format} />
              <p className="mt-1 text-xs font-medium text-ink-dim">{stat.label}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* ============================================================== */}
      {/* VIDEO PLAYER MODAL                                             */}
      {/* ============================================================== */}
      <AnimatePresence>
        {activeVideo && activeVideo.videoUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-6"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/20 bg-black shadow-2xl"
            >
              {/* Modal Header Bar */}
              <div className="flex items-center justify-between bg-slate-900 px-5 py-3.5 text-white">
                <div>
                  <h3 className="font-display text-sm font-bold">
                    {activeVideo.movieTitle} ({activeVideo.year})
                  </h3>
                  <p className="font-mono text-[11px] text-white/60">
                    DCPH Block Screening Highlight Video
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveVideo(null)}
                  aria-label="Close video modal"
                  className="rounded-full p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* HTML5 Video Player */}
              <div className="relative flex aspect-video items-center justify-center bg-black">
                <video
                  src={activeVideo.videoUrl}
                  controls
                  autoPlay
                  className="h-full w-full object-contain"
                />
              </div>

              <div className="flex items-center justify-between bg-slate-900 p-4 text-xs text-white/80">
                <span>Venue: {activeVideo.venue} • {activeVideo.attendees}</span>
                <span className="font-mono text-white/60">Detective Conan PH</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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