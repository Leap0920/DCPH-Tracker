import { Suspense } from "react"
import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"
import { HeroSection } from "@/components/marketing/HeroSection"
import { FeaturesGrid } from "@/components/marketing/FeaturesGrid"
import { HowItWorks } from "@/components/marketing/HowItWorks"
import { LatestContent } from "@/components/marketing/LatestContent"
import { HomeCta } from "@/components/marketing/HomeCta"
import { BlockScreeningSection } from "@/components/marketing/BlockScreeningSection"
import { FourYearsSection } from "@/components/marketing/FourYearsSection"
import { AccountDeletedNotice } from "@/components/layout/AccountDeletedNotice"
import {
  LiveEpisodeBadge,
  LiveEpisodeBadgeSkeleton,
} from "@/components/marketing/LiveEpisodeBadge"
import { getLatestEpisodeNumber, getLatestContent } from "@/lib/homepage-content"

export const metadata = {
  title: "Detective Conan PH · Track, Chat, and Climb the Ranks",
  description:
    "The Filipino Detective Conan community: track every episode, explore the story arcs, join the community chat, and prove your rank.",
}

// Cache the homepage feed for 5 minutes so a slow DB degrades to stale
// content instead of a slow TTFB on every visit.
export const revalidate = 300

export default async function HomePage() {
  // Parallelize the two homepage reads: costs max(slow read), not the sum,
  // each bounded by HOMEPAGE_TIMEOUT_MS with safe fallbacks.
  const [episode, entries] = await Promise.all([getLatestEpisodeNumber(), getLatestContent()])

  return (
    <div className="bg-page text-ink flex min-h-screen flex-col overflow-x-hidden w-full max-w-full">
      <Navbar />
      <main className="flex-1">
        {/* Client-side so reading the query string does not opt the whole
            marketing page out of static rendering. */}
        <Suspense fallback={null}>
          <AccountDeletedNotice />
        </Suspense>

        {/* The badge is a server component: it is created here and handed to the
            client HeroSection as a slot, so the episode query stays server-side. */}
        <HeroSection
          liveBadge={
            <Suspense fallback={<LiveEpisodeBadgeSkeleton />}>
              <LiveEpisodeBadge episode={episode} />
            </Suspense>
          }
        />

        {/* Vertical rhythm comes from clean, balanced whitespace */}
        <div className="py-12 sm:py-16 lg:py-20">
          <LatestContent entries={entries} />
        </div>

        <div className="py-12 sm:py-16 lg:py-20">
          <HowItWorks />
        </div>

        <div className="py-12 sm:py-16 lg:py-20">
          <FourYearsSection />
        </div>

        <BlockScreeningSection />

        <div className="py-12 sm:py-16 lg:py-20">
          <FeaturesGrid />
        </div>

        <HomeCta />
      </main>
      <Footer />
    </div>
  )
}