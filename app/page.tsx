import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"
import { HeroSection } from "@/components/marketing/HeroSection"
import { FeaturesGrid } from "@/components/marketing/FeaturesGrid"
import { HowItWorks } from "@/components/marketing/HowItWorks"
import { LatestContent } from "@/components/marketing/LatestContent"
import { HomeCta } from "@/components/marketing/HomeCta"
import { BlockScreeningSection } from "@/components/marketing/BlockScreeningSection"
import { FourYearsSection } from "@/components/marketing/FourYearsSection"

export const metadata = {
  title: "Detective Conan PH — Track, Chat, and Climb the Ranks",
  description:
    "The Filipino Detective Conan community: track every episode, explore the story arcs, join the community chat, and prove your rank.",
}

export default function HomePage() {
  return (
    <div className="bg-page text-ink flex min-h-screen flex-col overflow-x-hidden w-full max-w-full">
      <Navbar />
      <main className="flex-1">
        <HeroSection />

        {/* Vertical rhythm comes from clean, balanced whitespace */}
        <div className="py-12 sm:py-16 lg:py-20">
          <LatestContent />
        </div>

        <div className="py-12 sm:py-16 lg:py-20">
          <HowItWorks />
        </div>

        <div className="py-12 sm:py-16 lg:py-20">
          <FourYearsSection />
        </div>

        <div className="py-12 sm:py-16 lg:py-20">
          <BlockScreeningSection />
        </div>

        <div className="py-12 sm:py-16 lg:py-20">
          <FeaturesGrid />
        </div>

        <HomeCta />
      </main>
      <Footer />
    </div>
  )
}