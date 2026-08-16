"use client"

import { Tv, Play, FileText, Sparkles, Calendar, Film, Video } from "lucide-react"
import {
  CONTENT_TYPE_LABELS,
} from "@/lib/constants"
import type { ContentType } from "@/lib/constants"
import { SectionHeading } from "./SectionHeading"
import { BentoGrid, BentoCard } from "@/components/ui/bento-grid"

type LatestEntry = {
  id: string
  title: string
  type: string
  episode_number: number | null
  air_date: string
  slug: string | null
}

const bentoClasses = [
  // 2-col Bento (mobile/tablet) & 3-col Bento (desktop lg)
  "col-start-1 col-end-2 row-start-1 row-end-3 lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3", // Card 0: Ep 1209 (Tall Left)
  "col-start-2 col-end-3 row-start-1 row-end-2 lg:col-start-2 lg:col-end-3 lg:row-start-1 lg:row-end-2", // Card 1: Ep 1207 (Short Mid Top on lg)
  "col-start-2 col-end-3 row-start-2 row-end-3 lg:col-start-3 lg:col-end-4 lg:row-start-1 lg:row-end-2", // Card 2: Ep 1205 (Short Right Top on lg)
  "col-start-1 col-end-2 row-start-3 row-end-4 lg:col-start-1 lg:col-end-2 lg:row-start-3 lg:row-end-4", // Card 3: Ep 1208 (Short Left Bottom on lg)
  "col-start-2 col-end-3 row-start-3 row-end-5 lg:col-start-2 lg:col-end-3 lg:row-start-2 lg:row-end-4", // Card 4: Ep 1206 (Tall Mid Bottom on lg)
  "col-start-1 col-end-2 row-start-4 row-end-5 lg:col-start-3 lg:col-end-4 lg:row-start-2 lg:row-end-3", // Card 5: Ep 1204 (Short Right Mid on lg)
  "col-start-1 col-end-3 row-start-5 row-end-6 lg:col-start-3 lg:col-end-4 lg:row-start-3 lg:row-end-4", // Card 6: Ep 1203 (Full-width on mobile, Short Right Bottom on lg)
]

const bentoImages = [
  "/img/h1.jpg",
  "/img/h2.jpg",
  "/img/h3.jpg",
  "/img/h7.jpg",
  "/img/h4.jpg",
  "/img/h5.jpg",
  "/img/h6.jpg",
]

const bentoIcons = [Tv, Play, Sparkles, Video, Calendar, FileText, Film]

export function LatestContentGrid({ entries }: { entries: LatestEntry[] }) {
  return (
    <section className="mx-auto max-w-6xl px-3.5 sm:px-8 lg:px-12">
      <SectionHeading
        eyebrow="Fresh off the air"
        title="Latest content"
        subtitle="Jump back in where the case left off."
      />

      <div className="mt-8 sm:mt-12">
        <BentoGrid className="grid-rows-5 lg:grid-rows-3 gap-2.5 sm:gap-4 lg:gap-5">
          {entries.slice(0, 7).map((entry, index) => {
            const type = entry.type as ContentType
            const label = CONTENT_TYPE_LABELS[type] ?? "Episode"
            const Icon = bentoIcons[index % bentoIcons.length]
            const imgPath = bentoImages[index % bentoImages.length]
            const gridClass = bentoClasses[index] ?? ""

            return (
              <BentoCard
                key={entry.id}
                name={entry.title}
                className={gridClass}
                badge={entry.episode_number ? `Ep. ${entry.episode_number}` : label}
                date={entry.air_date}
                Icon={Icon}
                description={entry.episode_number ? `${label} • Episode ${entry.episode_number}` : label}
                href={`/tracker?type=${entry.type}`}
                cta="Watch episode"
                background={
                  <img
                    src={imgPath}
                    alt={entry.title}
                    className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                  />
                }
              />
            )
          })}
        </BentoGrid>
      </div>
    </section>
  )
}