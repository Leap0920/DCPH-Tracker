"use client"

import Link from "next/link"
import { motion, useMotionTemplate, useMotionValue } from "framer-motion"
import { ArrowRight, Eye, Target, Terminal, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"

const FLOATING_TEXTS = [
  "APTX-4869",
  "CASE FILE #962",
  "SUBJECT: SHERRY",
  "CODENAME: GIN",
  "VERMOUTH",
  "ORGANIZATION INTEL",
  "CLASSIFIED",
  "REDACTED",
  "SILVER BULLET",
  "BOURBON",
  "RUM",
]

export function HeroSection() {
  const [mounted, setMounted] = useState(false)
  
  // Mouse coordinates for dynamic spotlight effect
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  function handleMouseMove({ currentTarget, clientX, clientY }: React.MouseEvent) {
    const { left, top } = currentTarget.getBoundingClientRect()
    mouseX.set(clientX - left)
    mouseY.set(clientY - top)
  }

  return (
    <section 
      onMouseMove={handleMouseMove}
      className="relative overflow-hidden px-6 py-24 sm:py-36 bg-noir-black border-b border-poison-red/10 group/hero"
    >
      {/* Spotlight highlight */}
      <motion.div
        className="pointer-events-none absolute -inset-px opacity-0 group-hover/hero:opacity-100 transition-opacity duration-300 -z-10"
        style={{
          background: useMotionTemplate`
            radial-gradient(
              450px circle at ${mouseX}px ${mouseY}px,
              rgba(165, 32, 45, 0.07),
              transparent 80%
            )
          `,
        }}
      />

      {/* Cyber Grid Background */}
      <div className="absolute inset-0 -z-20 bg-[linear-gradient(to_right,rgba(165,32,45,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(165,32,45,0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

      {/* Classic background glow */}
      <div className="absolute inset-0 -z-30 overflow-hidden">
        <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[500px] w-[800px] bg-poison-red/10 blur-[130px] rounded-full" />
      </div>

      {/* Floating Intel Text Animation */}
      {mounted && (
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none select-none">
          {FLOATING_TEXTS.map((text, index) => {
            const left = `${(index * 9.5) % 90 + 5}%`
            const top = `${(index * 7.7) % 80 + 10}%`
            const duration = 12 + (index % 5) * 3
            const delay = (index % 4) * 2

            return (
              <motion.div
                key={text}
                className="absolute text-[10px] font-mono text-poison-red/20 uppercase tracking-widest whitespace-nowrap"
                style={{ left, top }}
                animate={{
                  y: [0, -30, 0],
                  opacity: [0.1, 0.4, 0.1],
                  scale: [0.95, 1.05, 0.95]
                }}
                transition={{
                  duration,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay,
                }}
              >
                {text}
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Gunshot Scope Animation HUD */}
      <div className="absolute right-10 top-1/2 -translate-y-1/2 w-96 h-96 border border-poison-red/10 rounded-full -z-10 hidden lg:flex items-center justify-center pointer-events-none">
        <motion.div 
          className="w-80 h-80 border border-dashed border-poison-red/15 rounded-full flex items-center justify-center"
          animate={{ rotate: 360 }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
        >
          <div className="w-2 h-2 bg-poison-red-bright/40 rounded-full" />
        </motion.div>
        {/* Horizontal Line */}
        <div className="absolute w-full h-[1px] bg-poison-red/10" />
        {/* Vertical Line */}
        <div className="absolute h-full w-[1px] bg-poison-red/10" />
        <div className="absolute top-4 left-4 font-mono text-[9px] text-silver-steel/30 uppercase tracking-wider">
          TARGET_ACQUIRED: 356A
        </div>
      </div>

      <div className="mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="inline-flex items-center gap-2 mb-4 bg-poison-red/10 border border-poison-red/30 px-3.5 py-1.5 rounded-sm">
            <ShieldAlert className="h-3.5 w-3.5 text-poison-red-bright animate-pulse" />
            <span className="case-number tracking-[0.2em] font-mono text-[10px] text-silver-steel uppercase">
              CLASSIFIED — LEVEL 5 CLEARANCE REQUIRED
            </span>
          </div>

          <h1 className="font-display text-6xl sm:text-8xl uppercase tracking-wider text-dossier-cream mb-6 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)] relative">
            Detective Conan{" "}
            <span className="text-poison-red-bright relative inline-block">
              PH
              <motion.span 
                className="absolute bottom-0 left-0 w-full h-[3px] bg-poison-red-bright"
                initial={{ width: 0 }}
                animate={{ width: "100%" }}
                transition={{ delay: 0.5, duration: 1 }}
              />
            </span>
          </h1>

          <p className="font-body text-lg sm:text-xl text-dossier-cream-dim max-w-2xl mx-auto mb-12 leading-relaxed drop-shadow">
            Welcome to the Filipino Detective Conan network. Intercept transmissions, catalogue story arcs, 
            log case files, and climb the ranks of the undercover investigation.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/tracker">
              <Button size="lg" className="w-full sm:w-auto bg-poison-red hover:bg-poison-red-bright text-dossier-cream px-8 h-12 uppercase tracking-wider font-display font-medium rounded-sm border border-poison-red-bright/20 shadow-[0_4px_20px_-5px_rgba(165,32,45,0.4)] transition-all hover:scale-[1.02]">
                Open Case Files
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/community/rankings">
              <Button variant="outline" size="lg" className="w-full sm:w-auto border-white/10 hover:border-poison-red-bright/40 hover:bg-case-file-raised text-dossier-cream-dim hover:text-dossier-cream px-8 h-12 uppercase tracking-wider font-display font-medium rounded-sm transition-all hover:scale-[1.02]">
                <Eye className="mr-2 h-4 w-4 text-poison-red-bright" />
                View Rankings
              </Button>
            </Link>
          </div>
        </motion.div>

        {/* Dynamic Stats Row with elegant animation */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-24 grid grid-cols-3 gap-6 max-w-xl mx-auto border-t border-white/5 pt-10"
        >
          {[
            { value: "1100+", label: "Episodes Logged", icon: Terminal },
            { value: "29", label: "Movies Cracked", icon: Target },
            { value: "50+", label: "Special Cases", icon: ShieldAlert },
          ].map((stat, i) => (
            <motion.div 
              key={stat.label} 
              className="text-center relative group"
              whileHover={{ y: -5 }}
              transition={{ duration: 0.2 }}
            >
              <div className="inline-block p-2 rounded-sm bg-white/5 mb-2 group-hover:bg-poison-red/10 transition-colors">
                <stat.icon className="h-4 w-4 text-silver-steel group-hover:text-poison-red-bright transition-colors" />
              </div>
              <div className="font-display text-3xl sm:text-4xl text-dossier-cream tracking-tight">
                {stat.value}
              </div>
              <div className="case-number mt-1 text-[10px] uppercase tracking-widest text-silver-steel/70">{stat.label}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
