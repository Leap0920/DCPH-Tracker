"use client"

import { motion, AnimatePresence, useScroll, useTransform, useSpring } from "framer-motion"
import { ArrowRight, ChevronDown } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useEffect, useState, useCallback, useRef } from "react"
import { createClient } from "@/utils/supabase/client"
import { openAuthModal } from "@/lib/auth-modal"

export function HeroSection() {
  const [typedText, setTypedText] = useState("")
  const [typingCompleted, setTypingCompleted] = useState(false)
  const fullText = "Your ultimate Detective Conan tracking platform"

  // Show the static Android banner on Android devices; keep the video everywhere else
  const [isAndroid, setIsAndroid] = useState(false)
  useEffect(() => {
    setIsAndroid(/android/i.test(navigator.userAgent))
  }, [])

  // Measure the promo video's true aspect ratio so it shows the full scene (no crop) while staying rounded
  const videoRef = useRef<HTMLVideoElement>(null)
  const [videoAspect, setVideoAspect] = useState<number | null>(null)

  // Typewriter effect with a quick initial delay
  useEffect(() => {
    let index = 0
    let interval: NodeJS.Timeout | null = null
    let timeout: NodeJS.Timeout | null = null

    timeout = setTimeout(() => {
      interval = setInterval(() => {
        if (index < fullText.length) {
          setTypedText(fullText.slice(0, index + 1))
          index++
        } else {
          if (interval) clearInterval(interval)
          // Delay a bit before revealing logo/title
          setTimeout(() => {
            setTypingCompleted(true)
          }, 250)
        }
      }, 22) // typing speed: 22ms per character
    }, 300) // 300ms initial delay

    return () => {
      if (interval) clearInterval(interval)
      if (timeout) clearTimeout(timeout)
    }
  }, [])

  // Render typed text with line break after "episode"
  const renderTypedText = (text: string) => {
    const line1 = "Your ultimate Detective Conan"
    const line2 = "tracking platform"
    const lineBreakIndex = line1.length

    const line1Chars = text.slice(0, Math.min(lineBreakIndex, text.length))
    const line2Chars = text.length > lineBreakIndex ? text.slice(lineBreakIndex) : ""

    return (
      <>
        <span className="text-2xl min-[421px]:text-3xl sm:text-5xl font-bold text-ink">
          {line1Chars}
        </span>
        {line2Chars.length > 0 && (
          <>
            <br />
            <span className="text-2xl min-[421px]:text-3xl sm:text-5xl font-bold text-ink">
              {line2Chars}
            </span>
          </>
        )}
      </>
    )
  }

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
    <section className="relative min-h-[100vh] flex flex-col items-center bg-surface overflow-hidden pb-12">
      {/* Hero Content Area — full-bleed image banner with left-aligned text */}
      <div className="relative min-h-[92vh] w-full flex flex-col items-start justify-center px-6 sm:px-12 lg:px-24 text-left">
        {/* Hero background image */}
        <div className="absolute inset-0 z-0">
          <img
            src="/hero-image.jpg"
            alt=""
            aria-hidden
            className="h-full w-full object-cover"
          />
          {/* Subtle left-to-right scrim so the dark text stays readable over the photo */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-white/85 via-white/40 to-transparent"
          />
        </div>

        {/* Left-aligned content above the image */}
        <div className="relative z-10 flex flex-col items-start w-full max-w-3xl -mt-12 sm:-mt-24">
          {/* Animated container for Logo and Main Heading */}
          <AnimatePresence>
            {typingCompleted && (
              <motion.div
                initial={{ opacity: 0, y: -60 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col items-center"
              >
                {/* Logo and Title in same row */}
                <div className="flex items-center gap-3 mb-6">
                  <img
                    src="/img/logo_DCPH.png"
                    alt="Detective Conan PH Logo"
                    className="h-10 w-auto object-contain drop-shadow-card hover:scale-105 transition-transform duration-300 pointer-events-none"
                  />
                  <h1 className="text-sm sm:text-base font-display font-semibold tracking-widest text-ink leading-tight">
                    Detective Conan PH: Anime and Manga
                  </h1>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Subtitle / Typewriter block */}
          <div className="min-h-16 flex items-center justify-start mt-4 mb-10">
            <p className="font-body text-ink max-w-5xl font-medium">
              {renderTypedText(typedText)}
              {/* Blinking typewriter cursor */}
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse" }}
                className="inline-block w-[3px] h-[1.1em] bg-gray-900 ml-1.5 align-middle"
              />
            </p>
          </div>

          {/* CTA Buttons — always visible, not gated behind the typewriter */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col sm:flex-row items-start gap-4"
          >
            <Button
              size="lg"
              onClick={handleTrackNow}
              className="bg-gray-950 hover:bg-gray-800 text-white px-8 h-11 text-sm font-semibold rounded-full shadow-md hover:shadow-lg transition-all hover:scale-[1.02]"
            >
              Track Now
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </motion.div>
        </div>

        {/* Scroll indicator at the bottom of the banner */}
        <AnimatePresence>
          {typingCompleted && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="absolute bottom-8 left-1/2 -translate-x-1/2 cursor-pointer z-20"
              onClick={scrollToContent}
            >
              <motion.div
                animate={{ y: [0, 8, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                className="flex flex-col items-center gap-2 hover:opacity-100 transition-opacity"
              >
                <span className="text-[10px] font-mono text-ink-dim">
                  Scroll Down
                </span>
                <ChevronDown className="h-5 w-5 text-ink-dim" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hero media — Android banner image (full, natural size) on Android; scroll-driven video elsewhere */}
      <div
        ref={scrollRef}
        style={!isAndroid ? { aspectRatio: videoAspect ? String(videoAspect) : "16 / 9" } : undefined}
        className={
          isAndroid
            ? "relative w-full overflow-hidden rounded-2xl z-10 mt-16 sm:mt-24"
            : "relative w-full overflow-hidden rounded-2xl z-10 mt-16 sm:mt-24 border-2 border-white/40"
        }
      >
        {isAndroid ? (
          <img
            src="/heroBanner-Android.jpg"
            alt="Detective Conan PH"
            className="w-full h-auto object-contain rounded-2xl"
          />
        ) : (
          <motion.div
            style={{ scale, opacity }}
            className="absolute inset-0 rounded-2xl overflow-hidden border-2 border-white/40"
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
              className="w-full h-full object-contain pointer-events-none rounded-2xl"
            />
          </motion.div>
        )}
      </div>
    </section>
  )
}
