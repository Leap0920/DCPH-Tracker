"use client"

import { motion } from "framer-motion"
import { BookOpen, Users, Trophy, MessageCircle } from "lucide-react"

const features = [
  {
    icon: BookOpen,
    title: "Case Tracker",
    description:
      "Track every episode, movie, special, and OVA. Filter by air date, story order, or arc.",
    fileNo: "001",
  },
  {
    icon: Users,
    title: "Story Arcs",
    description:
      "Follow major story arcs from the Boys' High School case to the Rum arc. Never miss a thread.",
    fileNo: "002",
  },
  {
    icon: Trophy,
    title: "Leaderboard",
    description:
      "Compete with fellow detectives. Climb ranks based on episodes watched, ratings, and engagement.",
    fileNo: "003",
  },
  {
    icon: MessageCircle,
    title: "Live Chat",
    description:
      "Discuss theories, episodes, and news in real-time chat rooms with the community.",
    fileNo: "004",
  },
]

export function FeaturesSection() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 flex items-center gap-3">
          <span className="case-number">FILE NO. 010 — CAPABILITIES</span>
          <span className="redacted-bar w-16" />
        </div>

        <h2 className="font-display text-3xl sm:text-4xl uppercase tracking-wide text-dossier-cream mb-4">
          What&apos;s in the dossier
        </h2>
        <p className="text-dossier-cream-dim max-w-xl mb-12">
          Everything a detective needs to track their progress through the Detective Conan universe.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
            >
              <div className="dossier-card p-6 h-full">
                <span className="dossier-stamp">{feature.fileNo}</span>
                <feature.icon className="h-8 w-8 text-poison-red-bright mb-4" />
                <h3 className="font-display text-lg uppercase tracking-wide text-dossier-cream mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-dossier-cream-dim">
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
