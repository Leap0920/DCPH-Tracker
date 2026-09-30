"use client"

import { Hero04 } from "@/components/ui/hero-04"

export function BlockScreeningSection() {
  return (
    <section className="relative overflow-hidden bg-surface">
      <Hero04
        title="Annual Block Screenings"
        titleLine2="Movie 29 · SM North EDSA"
        description="Movie 29 on the big screen — merch, cosplay and raffles with the whole community."
        primaryImage="/Bs2026.jpg"
        primaryAlt="Detective Conan Movie 29 Block Screening Promo Poster"
        animation="subtle"
        variant="standard"
        primaryCTA={{
          ctaEnabled: true,
          text: "Register now",
          link: "https://www.facebook.com/groups/dcphanimeandmanga/permalink/3448422521992339",
          variant: "default",
          size: "lg",
          target: "_blank",
        }}
        secondaryCTA={{
          ctaEnabled: true,
          text: "See More",
          link: "https://www.facebook.com/groups/1506883556146255",
          variant: "outline",
          size: "lg",
          target: "_blank",
        }}
      />
    </section>
  )
}