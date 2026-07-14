import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"
import { HeroSection } from "@/components/marketing/HeroSection"
import { FeaturesSection } from "@/components/marketing/FeaturesSection"
import { SocialMediaSection } from "@/components/social/SocialMediaSection"
import { MovieScreeningBanner } from "@/components/screening/MovieScreeningBanner"

export default function HomePage() {
  return (
    <div className="homepage-light-theme bg-white text-gray-900 flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <MovieScreeningBanner />
        <SocialMediaSection />
      </main>
      <Footer />
    </div>
  )
}
