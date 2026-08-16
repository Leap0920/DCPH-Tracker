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
    <div className="bg-page text-ink flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <HeroSection />

        <div className="border-t border-slate-200/70">
          <div className="py-16">
            <LatestContent />
          </div>
        </div>

        <div className="border-t border-slate-200/70">
          <div className="py-16">
            <HowItWorks />
          </div>
        </div>

        <div className="border-t border-slate-200/70">
          <div className="py-16">
            <FourYearsSection />
          </div>
        </div>

        <div className="border-t border-slate-200/70">
          <div className="py-16">
            <BlockScreeningSection />
          </div>
        </div>

        <div className="border-t border-slate-200/70">
          <div className="py-16">
            <FeaturesGrid />
          </div>
        </div>

        <HomeCta />
      </main>
      <Footer />
    </div>
  )
}