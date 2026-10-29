"use client"

import Link from "next/link"
import { useRef, useState } from "react"
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion"

type Beat = {
  id: string
  index: string
  kicker: string
  title: string
  body: string
  href: string
  cta: string
}

const BEATS: Beat[] = [
  {
    id: "tracker",
    index: "01",
    kicker: "The tracker",
    title: "Every case, one grid.",
    body: "Episodes, movies, specials and OVAs tick off as you watch. Progress saves the moment you tap.",
    href: "/tracker",
    cta: "Open the tracker",
  },
  {
    id: "cast",
    index: "02",
    kicker: "The cast",
    title: "The cast, one red string.",
    body: "Zoom the character web, tap a face, and read the dossier behind it.",
    href: "/characters",
    cta: "Open the cast",
  },
  {
    id: "ranks",
    index: "03",
    kicker: "The board",
    title: "Ranks that move when you watch.",
    body: "Every episode counts toward your place on the board, on every content type.",
    href: "/community/rankings",
    cta: "See the rankings",
  },
]

/**
 * Scroll-driven story band, type only.
 *
 * Desktop pins the section for two viewports and scrubs the copy while a large
 * numeral turns over beside it. No imagery: the type and the black around it
 * are the composition.
 *
 * Copy beats never overlap. Each one clears before the next arrives, so the
 * fade windows are butted end to end rather than crossed: a cross-fade left two
 * headlines stacked on screen and read as a rendering glitch.
 *
 * Phones and reduced-motion visitors get the same three beats stacked, with no
 * pinning and no scrub.
 */
export function ScrollStory() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  })
  // Spring-smoothed so trackpad jumps still read as a glide, not a cut.
  const progress = useSpring(scrollYProgress, {
    stiffness: 70,
    damping: 22,
    restDelta: 0.001,
  })

  // Which beat is up right now, for the numeral and the progress ticks.
  const [active, setActive] = useState(0)
  useMotionValueEvent(progress, "change", (value) => {
    const next = Math.min(BEATS.length - 1, Math.max(0, Math.floor(value * BEATS.length)))
    setActive((current) => (current === next ? current : next))
  })

  if (reduce) return <StackedBeats />

  return (
    <section aria-label="What you can do here" className="relative">
      <div ref={ref} className="relative hidden h-[200vh] lg:block">
        <div className="sticky top-0 flex h-[100dvh] flex-col justify-center overflow-hidden bg-page">
          <div className="mx-auto w-full max-w-6xl px-12">
            <div className="grid grid-cols-[1fr_auto] items-center gap-12">
              <div className="relative min-h-[17rem]">
                {BEATS.map((beat, i) => (
                  <Copy
                    key={beat.id}
                    beat={beat}
                    index={i}
                    total={BEATS.length}
                    progress={progress}
                  />
                ))}
              </div>

              <div className="flex h-[17rem] w-[15rem] items-center justify-end overflow-hidden">
                <motion.span
                  key={active}
                  initial={{ opacity: 0, y: 26 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  aria-hidden
                  className="select-none font-display text-[12rem] font-medium leading-none tracking-[-0.06em] text-ink/[0.08] tabular-nums"
                >
                  {BEATS[active].index}
                </motion.span>
              </div>
            </div>

            <div className="mt-14">
              <ProgressBar progress={progress} total={BEATS.length} active={active} />
            </div>
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <StackedBeats />
      </div>
    </section>
  )
}

function StackedBeats() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14 sm:px-12">
      <ol className="divide-y divide-line">
        {BEATS.map((beat) => (
          <li key={beat.id} className="py-8 first:pt-0 last:pb-0">
            <div className="flex items-baseline gap-4">
              <span
                aria-hidden
                className="font-display text-4xl font-medium leading-none tracking-[-0.04em] text-ink/10 tabular-nums"
              >
                {beat.index}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-faint">
                {beat.kicker}
              </span>
            </div>
            <h2 className="mt-4 max-w-[22ch] font-display text-2xl font-medium leading-[1.08] tracking-[-0.02em] text-ink">
              {beat.title}
            </h2>
            <p className="mt-2 max-w-[42ch] text-sm leading-relaxed text-ink-dim">{beat.body}</p>
            <Link
              href={beat.href}
              className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.2em] text-accent"
            >
              {beat.cta} →
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}

function range(index: number, total: number) {
  const start = index / total
  const end = (index + 1) / total
  const fade = 0.045
  return { start, end, fade }
}

/**
 * Opacity keyframes for one beat.
 *
 * The windows are butted, not crossed: beat n is fully gone by the time beat
 * n+1 starts coming up. The first beat is already on screen at progress 0, and
 * the last one holds through the end of the section.
 */
function beatOpacity(index: number, total: number) {
  const { start, end, fade } = range(index, total)
  const first = index === 0
  const last = index === total - 1

  if (first && last) return { input: [0, 1], output: [1, 1] }
  if (first) return { input: [0, end - fade, end], output: [1, 1, 0] }
  if (last) return { input: [start, start + fade, 1], output: [0, 1, 1] }
  return { input: [start, start + fade, end - fade, end], output: [0, 1, 1, 0] }
}

function Copy({
  beat,
  index,
  total,
  progress,
}: {
  beat: Beat
  index: number
  total: number
  progress: MotionValue<number>
}) {
  const { start, end } = range(index, total)
  const { input, output } = beatOpacity(index, total)
  const opacity = useTransform(progress, input, output)
  const y = useTransform(progress, [start, end], [18, -18])

  return (
    <motion.div style={{ opacity, y }} className="absolute inset-0 flex flex-col justify-center">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] tabular-nums text-accent">{beat.index}</span>
        <span aria-hidden className="h-px w-10 bg-line" />
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink-faint">
          {beat.kicker}
        </span>
      </div>

      <h2 className="mt-5 max-w-[16ch] font-display text-[clamp(2rem,4.2vw,4rem)] font-medium leading-[1.02] tracking-[-0.035em] text-ink">
        {beat.title}
      </h2>

      <p className="mt-5 max-w-[42ch] text-sm leading-relaxed text-ink-dim sm:text-base">
        {beat.body}
      </p>

      <Link
        href={beat.href}
        className="group mt-8 inline-flex items-center gap-2 self-start border-b border-accent/40 pb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-accent transition-colors hover:border-accent hover:text-accent-bright"
      >
        {beat.cta}
        <span aria-hidden className="transition-transform group-hover:translate-x-1">
          →
        </span>
      </Link>
    </motion.div>
  )
}

function ProgressBar({
  progress,
  total,
  active,
}: {
  progress: MotionValue<number>
  total: number
  active: number
}) {
  return (
    <div>
      <div className="flex gap-2">
        {Array.from({ length: total }).map((_, i) => (
          <Segment key={i} progress={progress} index={i} total={total} />
        ))}
      </div>
      <div className="mt-3 flex gap-2 font-mono text-[11px] uppercase tracking-[0.24em]">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={i === active ? "flex-1 text-ink" : "flex-1 text-ink-faint"}>
            {String(i + 1).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  )
}

function Segment({
  progress,
  index,
  total,
}: {
  progress: MotionValue<number>
  index: number
  total: number
}) {
  const scaleX = useTransform(progress, (value) =>
    Math.min(1, Math.max(0, value * total - index))
  )

  return (
    <div className="relative h-[2px] flex-1 overflow-hidden rounded-full bg-line">
      <motion.span
        style={{ scaleX }}
        className="absolute inset-0 origin-left rounded-full bg-accent"
      />
    </div>
  )
}
