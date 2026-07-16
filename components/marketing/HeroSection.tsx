"use client"

import { motion, AnimatePresence, useScroll, useTransform, useSpring } from "framer-motion"
import { ArrowRight, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEffect, useState, useCallback, useRef } from "react"

export function HeroSection() {
  const [typedText, setTypedText] = useState("")
  const [typingCompleted, setTypingCompleted] = useState(false)
  const fullText = "Your ultimate Detective Conan tracking platform"

  // Typewriter effect with 2-second delay
  useEffect(() => {
    let index = 0
    let interval: NodeJS.Timeout | null = null
    let timeout: NodeJS.Timeout | null = null

    // Wait 2 seconds before starting to type
    timeout = setTimeout(() => {
      interval = setInterval(() => {
        if (index < fullText.length) {
          setTypedText(fullText.slice(0, index + 1))
          index++
        } else {
          if (interval) clearInterval(interval)
          // Delay a bit before revealing logo/title and buttons
          setTimeout(() => {
            setTypingCompleted(true)
          }, 400)
        }
      }, 65) // slower typing speed: 65ms per character
    }, 2000) // 2 second initial delay

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
        <span className="text-3xl sm:text-5xl font-bold text-gray-900">
          {line1Chars}
        </span>
        {line2Chars.length > 0 && (
          <>
            <br />
            <span className="text-3xl sm:text-5xl font-bold text-gray-900">
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
  const borderRadius = useTransform(smoothProgress, [0, 0.45, 0.55, 1], ["2.5rem", "0.75rem", "0.75rem", "2.5rem"])
  const opacity = useTransform(smoothProgress, [0, 0.2, 0.8, 1], [0.8, 1, 1, 0.8])

  const scrollToContent = useCallback(() => {
    window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" })
  }, [])

  return (
    <section className="relative min-h-[160vh] flex flex-col items-center bg-white overflow-hidden pb-24">
      {/* Light minimalist grid pattern */}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#f3f4f6_1px,transparent_1px),linear-gradient(to_bottom,#f3f4f6_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

      {/* Hero Content Area */}
      <div className="min-h-[72vh] flex flex-col items-center justify-start px-6 text-center w-full max-w-4xl mx-auto pt-32 pb-6">

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
                  className="h-10 w-auto object-contain drop-shadow-sm hover:scale-105 transition-transform duration-300 pointer-events-none"
                />
                <h1 className="text-sm sm:text-base font-display font-semibold tracking-widest text-gray-900 leading-tight uppercase">
                  Detective Conan PH: Anime and Manga
                </h1>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Subtitle / Typewriter block */}
        <div className="min-h-16 flex items-center justify-center mt-4 mb-10">
          <p className="font-body text-gray-900 max-w-5xl mx-auto font-medium">
            {renderTypedText(typedText)}
            {/* Blinking typewriter cursor */}
            <motion.span
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse" }}
              className="inline-block w-[3px] h-[1.1em] bg-gray-900 ml-1.5 align-middle"
            />
          </p>
        </div>

        {/* CTA Buttons */}
        <AnimatePresence>
          {typingCompleted && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col sm:flex-row items-center gap-4"
            >
              <a href="/tracker">
                <Button
                  size="lg"
                  className="bg-gray-950 hover:bg-gray-800 text-white px-8 h-11 text-sm font-semibold rounded-full shadow-md hover:shadow-lg transition-all hover:scale-[1.02]"
                >
                  Track Now
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
              <Button
                variant="outline"
                size="lg"
                onClick={scrollToContent}
                className="border-gray-300 hover:border-gray-400 bg-white hover:bg-gray-50 text-gray-700 hover:text-gray-900 px-8 h-11 text-sm font-semibold rounded-full transition-all"
              >
                Explore Now
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Scroll indicator (visible when loading is complete) */}
      <AnimatePresence>
        {typingCompleted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.6, duration: 0.8 }}
            className="absolute bottom-12 left-1/2 -translate-x-1/2 cursor-pointer z-20"
            onClick={scrollToContent}
          >
            <motion.div
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="flex flex-col items-center gap-2 hover:opacity-100 transition-opacity"
            >
              <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                Scroll Down
              </span>
              <ChevronDown className="h-5 w-5 text-gray-500" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scroll-driven Video Section */}
      <div
        ref={scrollRef}
        className="w-full max-w-[95vw] mx-auto mt-24 flex items-center justify-center relative z-10"
      >
        <motion.div
          style={{
            scale,
            borderRadius,
            opacity,
          }}
          className="w-full aspect-video overflow-hidden shadow-2xl bg-gray-100 border border-gray-200/50"
        >
          <video
            src="/img/Banner.mp4"
            autoPlay
            loop
            muted
            playsInline
            controls={false}
            className="w-full h-full object-cover pointer-events-none"
          />
        </motion.div>
      </div>
    </section>
  )
}
