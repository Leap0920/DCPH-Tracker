"use client"

import { motion } from "framer-motion"
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
  "lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3", // Left top (2 rows)
  "lg:col-start-1 lg:col-end-2 lg:row-start-3 lg:row-end-4", // Left bottom (1 row)
  "lg:col-start-2 lg:col-end-3 lg:row-start-1 lg:row-end-2", // Middle top (1 row)
  "lg:col-start-2 lg:col-end-3 lg:row-start-2 lg:row-end-4", // Middle bottom (2 rows - split!)
  "lg:col-start-3 lg:col-end-4 lg:row-start-1 lg:row-end-2", // Right top (1 row)
  "lg:col-start-3 lg:col-end-4 lg:row-start-2 lg:row-end-3", // Right middle (1 row)
  "lg:col-start-3 lg:col-end-4 lg:row-start-3 lg:row-end-4", // Right bottom (1 row)
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
    <section className="mx-auto max-w-6xl px-6">
      <SectionHeading
        eyebrow="Fresh off the air"
        title="Latest content"
        subtitle="Jump back in where the case left off."
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.6 }}
        className="mt-10"
      >
        <BentoGrid className="lg:grid-rows-3 min-h-[640px] gap-4">
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
      </motion.div>
    </section>
  )
}