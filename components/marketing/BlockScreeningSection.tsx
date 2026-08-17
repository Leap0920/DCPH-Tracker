"use client"

import { Hero04 } from "@/components/ui/hero-04"

export function BlockScreeningSection() {
  return (
    <section className="relative overflow-hidden bg-white">
      <Hero04
        title="DCPH Annual Block Screenings"
        titleLine2="Movie 29 Cinema Event • SM North EDSA"
        description="Gathering Filipino Conan fans for grand cinema screenings at SM North EDSA with exclusive merch, cosplay, raffle prizes, and premiere celebrations."
        primaryImage="/Bs2026.jpg"
        primaryAlt="Detective Conan Movie 29 Block Screening Promo Poster"
        animation="subtle"
        variant="standard"
        primaryCTA={{
          ctaEnabled: true,
          text: "Register for Block Screening",
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