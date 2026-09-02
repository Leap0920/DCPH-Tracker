'use client'

import * as React from 'react'
import Image from 'next/image'
import { motion, useReducedMotion, type Variants } from 'framer-motion'
import Balancer from 'react-wrap-balancer'

import { cn } from '@/lib/utils'

import { Cta, type CtaProps } from '@/components/ui/hero-04-utils/cta'
import { ArtCollage } from '@/components/ui/hero-04-utils/art-collage'

export interface Hero04Props {
  title: string
  washImage?: string
  titleLine2?: string
  description: string
  primaryImage: string
  secondaryImage?: string
  primaryAlt?: string
  secondaryAlt?: string
  animation?: 'none' | 'subtle'
  primaryCTA: CtaProps
  secondaryCTA?: CtaProps
  variant?: 'standard' | 'compact'
}

const variantStyles = {
  standard: {
    section: 'py-20 sm:py-28',
    title: 'text-3xl sm:text-4xl md:text-5xl',
    description: 'max-w-md text-sm sm:text-base',
    header: 'gap-5',
    grid: 'gap-12 lg:gap-16',
  },
  compact: {
    section: 'py-14 sm:py-20',
    title: 'text-2xl sm:text-3xl md:text-4xl',
    description: 'max-w-sm text-sm',
    header: 'gap-4',
    grid: 'gap-10 lg:gap-12',
  },
} as const

const container: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
}

const item: Variants = {
  hidden: { opacity: 0, y: 12, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
}

const mediaItem: Variants = {
  hidden: { opacity: 0, y: 24, filter: 'blur(8px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
}

function Reveal({
  active,
  variants,
  className,
  children,
}: Readonly<{
  active: boolean
  variants?: Variants
  className?: string
  children: React.ReactNode
}>) {
  if (!active) return <div className={className}>{children}</div>

  return (
    <motion.div variants={variants ?? item} className={className}>
      {children}
    </motion.div>
  )
}

export function Hero04({
  title,
  titleLine2,
  description,
  washImage,
  primaryImage,
  secondaryImage,
  primaryAlt = '',
  secondaryAlt = '',
  animation = 'none',
  primaryCTA,
  secondaryCTA,
  variant = 'standard',
}: Readonly<Hero04Props>) {
  const reduce = useReducedMotion()
  const animate = animation === 'subtle' && !reduce
  const vs = variantStyles[variant]

  const backgroundElement = washImage && (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 aspect-[2/3] mask-radial-[75%_100%] mask-radial-from-45% mask-radial-to-75% mask-radial-at-top opacity-75 blur-xl md:aspect-square lg:aspect-video dark:opacity-5"
    >
      <Image
        src={washImage}
        alt=""
        fill
        sizes="100vw"
        loading="lazy"
        className="h-full w-full object-cover object-top"
      />
    </div>
  )

  const titleElement = title && (
    <h1
      className={cn(
        'text-ink font-display font-bold tracking-tight text-balance',
        vs.title,
      )}
    >
      <Balancer>{title}</Balancer>
      {titleLine2 && (
        <>
          <br />
          <Balancer>{titleLine2}</Balancer>
        </>
      )}
    </h1>
  )

  const descriptionElement = description && (
    <p className={cn('text-ink-dim font-body leading-relaxed', vs.description)}>
      <Balancer>{description}</Balancer>
    </p>
  )

  const ctasElement = (primaryCTA?.ctaEnabled || secondaryCTA?.ctaEnabled) && (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-3">
      {primaryCTA?.ctaEnabled && <Cta cta={primaryCTA} />}
      {secondaryCTA?.ctaEnabled && (
        <Cta
          cta={{ ...secondaryCTA, variant: secondaryCTA.variant ?? 'outline' }}
        />
      )}
    </div>
  )

  const mediaElement = (
    <ArtCollage
      primaryImage={primaryImage}
      secondaryImage={secondaryImage}
      primaryAlt={primaryAlt}
      secondaryAlt={secondaryAlt}
    />
  )

  return (
    <section className="bg-surface relative isolate w-full overflow-hidden border-y border-ink-dim/20">
      {backgroundElement}

      <motion.div
        className={cn(
          'relative z-10 mx-auto grid max-w-6xl grid-cols-1 items-center px-6 sm:px-12 lg:grid-cols-2',
          vs.section,
          vs.grid,
        )}
        variants={animate ? container : undefined}
        initial={animate ? 'hidden' : false}
        whileInView={animate ? 'visible' : undefined}
        viewport={{ once: true, margin: '-80px' }}
      >
        <Reveal
          active={animate}
          className={cn('flex flex-col items-start', vs.header)}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-soft px-3.5 py-1 font-mono text-xs font-semibold uppercase tracking-widest text-accent dark:text-accent-bright mb-2">
            Annual Block Screenings
          </span>
          {titleElement}
          {descriptionElement}
          {ctasElement}
        </Reveal>

        <Reveal active={animate} variants={mediaItem} className="w-full">
          {mediaElement}
        </Reveal>
      </motion.div>
    </section>
  )
}

export default Hero04
