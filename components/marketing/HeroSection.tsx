"use client"

import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion"
import { ArrowRight, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEffect, useState, useCallback, useRef } from "react"

export function HeroSection() {
  const [typedText, setTypedText] = useState("")
  const [typingCompleted, setTypingCompleted] = useState(false)
  const fullText = "Your ultimate Detective Conan episode tracking platform"

  // Typewriter effect
  useEffect(() => {
    let index = 0
    const interval = setInterval(() => {
      if (index < fullText.length) {
        setTypedText(fullText.slice(0, index + 1))
        index++
      } else {
        clearInterval(interval)
        // Delay a bit before revealing logo/title
        setTimeout(() => {
          setTypingCompleted(true)
        }, 400)
      }
    }, 45) // typing speed: 45ms per character

    return () => clearInterval(interval)
  }, [])

  const scrollRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: scrollRef,
    offset: ["start end", "end start"]
  })

  // Smooth scroll animations for the video banner
  const scale = useTransform(scrollYProgress, [0, 0.45, 0.55, 1], [0.85, 1.05, 1.05, 0.85])
  const borderRadius = useTransform(scrollYProgress, [0, 0.45, 0.55, 1], ["5rem", "1.5rem", "1.5rem", "5rem"])
  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.7, 1, 1, 0.7])

  const scrollToContent = useCallback(() => {
    window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" })
  }, [])

  return (
    <section className="relative min-h-[160vh] flex flex-col items-center bg-white overflow-hidden pb-24">
      {/* Light minimalist grid pattern */}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#f3f4f6_1px,transparent_1px),linear-gradient(to_bottom,#f3f4f6_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />

      {/* Hero Content Area */}
      <div className="min-h-[85vh] flex flex-col items-center justify-center px-6 text-center w-full max-w-4xl mx-auto pt-16">
        
        {/* Animated container for Logo and Main Heading */}
        <AnimatePresence>
          {typingCompleted && (
            <motion.div
              initial={{ opacity: 0, y: -60 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col items-center"
            >
              {/* Logo */}
              <div className="mb-6 flex justify-center">
                <img
                  src="/img/logo_DCPH.png"
                  alt="Detective Conan PH Logo"
                  className="h-28 w-auto object-contain drop-shadow-sm hover:scale-105 transition-transform duration-300 pointer-events-none"
                />
              </div>

              {/* Title */}
              <h1 className="text-4xl sm:text-6xl font-display font-bold tracking-tight text-gray-900 leading-tight mb-4 uppercase">
                Detective Conan PH: <span className="text-gray-500">Anime and Manga</span>
              </h1>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Subtitle / Typewriter block */}
        <div className="h-12 flex items-center justify-center mt-4 mb-10">
          <p className="text-lg sm:text-xl font-body text-gray-600 max-w-xl mx-auto font-medium">
            {typedText}
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
                  className="bg-gray-950 hover:bg-gray-800 text-white px-10 h-14 text-base font-semibold rounded-full shadow-md hover:shadow-lg transition-all hover:scale-[1.02]"
                >
                  Track Now
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </a>
              <Button
                variant="outline"
                size="lg"
                onClick={scrollToContent}
                className="border-gray-300 hover:border-gray-400 bg-white hover:bg-gray-50 text-gray-700 hover:text-gray-955 px-10 h-14 text-base font-semibold rounded-full transition-all"
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
        className="w-full max-w-5xl px-6 mx-auto mt-24 flex items-center justify-center relative z-10"
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
