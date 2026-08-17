"use client"

import * as React from "react"

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
    <div className="relative mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200/80 bg-surface shadow-xl transition-all hover:shadow-2xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={primaryImage}
        alt={primaryAlt}
        className="h-auto w-full object-contain rounded-2xl"
      />
    </div>
  )
}
