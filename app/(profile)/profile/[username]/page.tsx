import { notFound } from "next/navigation"
import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"
import { ProfileCard } from "@/components/profile/ProfileCard"
import { StatsGrid } from "@/components/profile/StatsGrid"
import { getProfileByUsername, getProfileStats } from "@/lib/queries/profile"

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params

  try {
    const profile = await getProfileByUsername(username)
    const stats = await getProfileStats(profile.user_id)

    return (
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1 px-6 py-10">
          <div className="mx-auto max-w-3xl">
            <div className="mb-8 flex items-center gap-3">
              <span className="case-number">FILE NO. 007 — AGENT DOSSIER</span>
              <span className="redacted-bar w-16" />
            </div>

            <ProfileCard profile={profile} />
            <StatsGrid stats={stats} />
          </div>
        </main>
        <Footer />
      </div>
    )
  } catch {
    notFound()
  }
}
