"use client"

import * as React from "react"
import Image from "next/image"

export interface ArtCollageProps {
  primaryImage: string
  secondaryImage?: string
  primaryAlt?: string
  secondaryAlt?: string
}

export function ArtCollage({
  primaryImage,
  primaryAlt = "Detective Conan Block Screening Promo Poster",
}: ArtCollageProps) {
  return (
    <div className="relative mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-ink-dim/20 bg-surface shadow-xl transition-all hover:shadow-2xl aspect-[3/4] sm:aspect-[4/5]">
      <Image
        src={primaryImage}
        alt={primaryAlt}
        fill
        sizes="(max-width: 768px) 100vw, 512px"
        loading="lazy"
        className="h-full w-full object-cover rounded-2xl"
      />
    </div>
  )
}

