"use client"

import { motion, useScroll, useTransform, useSpring, useReducedMotion } from "framer-motion"
import { ArrowRight, ChevronDown } from "lucide-react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { useEffect, useState, useCallback, useRef, type ReactNode } from "react"
import { createClient } from "@/utils/supabase/client"
import { openAuthModal } from "@/lib/auth-modal"
import { LiveStats } from "@/components/marketing/LiveStats"

const EASE = [0.16, 1, 0.3, 1] as const

type HeroSectionProps = {
  /**
   * Slot for the server-rendered <LiveEpisodeBadge />. This is a client
   * component, so it cannot await a server component itself — app/page.tsx
   * creates the element and passes it down as a ReactNode.
   */
  liveBadge?: ReactNode
}

export function HeroSection({ liveBadge }: HeroSectionProps) {
  const reduce = useReducedMotion()

  // Measure the promo video's true aspect ratio so it shows the full scene (no crop) while staying rounded
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoAspect, setVideoAspect] = useState<number | null>(null)

  // Ensure video plays automatically on mobile devices
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => { })
    }
  }, [])

  const scrollRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: scrollRef,
    offset: ["start end", "end start"]
  })

  // Create a slow, smooth version of the scroll progress using spring physics
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 45,  // lower stiffness for a slower, smoother slide
    damping: 24,    // damping for clean deceleration without bounciness
    restDelta: 0.001
  })

  // Smooth scroll animations for the video banner (scales to 95% full screen width) mapped to spring physics
  const scale = useTransform(smoothProgress, [0, 0.45, 0.55, 1], [0.72, 1.0, 1.0, 0.72])
  const opacity = useTransform(smoothProgress, [0, 0.2, 0.8, 1], [0.8, 1, 1, 0.8])

  const scrollToContent = useCallback(() => {
    window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" })
  }, [])

  const router = useRouter()
  const supabase = createClient()

  // Track Now: signed-in users go straight to the tracker; everyone else gets
  // the sign-in modal.
  async function handleTrackNow() {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      router.push("/tracker")
    } else {
      openAuthModal("signin")
    }
  }

  return (
    <section className="relative min-h-[100dvh] flex flex-col items-center bg-page overflow-hidden pt-16 pb-12">
      {/* Hero Content Area — full-bleed image banner with left-aligned text */}
      <div className="relative min-h-[calc(100dvh-4rem)] w-full flex flex-col items-start justify-center px-6 sm:px-12 lg:px-24 text-left">
        {/*
          Hero background image — theme-aware via Next.js Image with high priority
          for immediate LCP discovery and zero layout shift.
        */}
        <div className="absolute inset-0 z-0 bg-surface overflow-hidden pointer-events-none">
          <Image
            src="/hero-image-darkM.jpg"
            alt="Detective Conan Banner"
            fill
            priority
            sizes="100vw"
            className="object-cover object-right sm:object-right-bottom dark:block hidden"
          />
          <Image
            src="/hero-image.jpg"
            alt="Detective Conan Banner"
            fill
            priority
            sizes="100vw"
            className="object-cover object-right sm:object-right-bottom dark:hidden block"
          />
          {/* Left-to-right scrim so text stays readable over photo, per theme */}
          <div aria-hidden className="hero-scrim hero-scrim-light" />
          <div aria-hidden className="hero-scrim hero-scrim-dark" />
        </div>

        {/* Left-aligned content above the image */}
        <div className="relative z-10 flex flex-col items-start w-full max-w-3xl">
          {/* Logo and live-episode badge */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="flex flex-col items-start"
          >
            <div className="flex items-center gap-3 mb-6">
              <Image
                src="/img/logo_DCPH.png"
                alt="Detective Conan PH Logo"
                width={40}
                height={40}
                priority
                className="h-10 w-10 object-contain drop-shadow-card hover:scale-105 transition-transform duration-300 pointer-events-none"
              />
              {liveBadge}
            </div>
          </motion.div>

          {/* Discoverable H1 heading rendered directly in initial HTML */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE }}
            className="mt-2 mb-8"
          >
            <h1 className="hero-text-shadow font-display text-2xl min-[421px]:text-3xl sm:text-5xl font-bold text-ink leading-tight tracking-tight text-balance">
              <span className="block">Your ultimate Detective Conan</span>
              <span className="block">tracking platform</span>
            </h1>
          </motion.div>

          {/* CTA Buttons — always visible */}
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
            className="flex flex-col sm:flex-row items-start gap-4"
          >
            <motion.div
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              <Button
                size="lg"
                onClick={handleTrackNow}
                className="bg-accent hover:bg-accent-bright text-white px-8 h-11 text-sm font-semibold rounded-full shadow-md hover:shadow-lg transition-all hover:scale-[1.02]"
              >
                Track Now
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          </motion.div>

          {/* Live all-time + active-now stats */}
          <div className="mt-8">
            <LiveStats />
          </div>
        </div>

        {/* Scroll indicator at the bottom of the banner */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.6 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 cursor-pointer z-20"
          onClick={scrollToContent}
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            className="flex flex-col items-center gap-2 hover:opacity-100 transition-opacity"
          >
            <span className="hero-text-shadow text-[10px] font-mono text-ink-dim">
              Scroll Down
            </span>
            <ChevronDown className="h-5 w-5 text-ink-dim" />
          </motion.div>
        </motion.div>
      </div>

      {/* Hero media — scroll-driven video — borderless, maximized width */}
      <div
        ref={scrollRef}
        style={{ aspectRatio: videoAspect ? String(videoAspect) : "16 / 9" }}
        className="relative w-full max-w-[1600px] px-2 sm:px-4 lg:px-6 overflow-hidden rounded-2xl z-10 mt-10 sm:mt-24 border-0"
      >
        <motion.div
          style={{ scale, opacity }}
          className="absolute inset-0 rounded-2xl overflow-hidden"
        >
          <video
            ref={videoRef}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight)
            }}
            src="/img/Banner.mp4"
            autoPlay
            loop
            muted
            playsInline
            controls={false}
            aria-label="Detective Conan PH Community Banner Video"
            title="Detective Conan PH Community Banner"
            className="w-full h-full object-contain pointer-events-none rounded-2xl"
          >
            <track kind="captions" srcLang="en" label="No commentary" />
          </video>
        </motion.div>
      </div>
    </section>
  )
}