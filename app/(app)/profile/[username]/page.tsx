import { ProfileCard } from "@/components/profile/ProfileCard"
import { StatsGrid } from "@/components/profile/StatsGrid"
import { getProfileByUsername, getProfileStats } from "@/lib/queries/profile"
import { createClient } from "@/utils/supabase/server"
import { notFound } from "next/navigation"

export const metadata = {
  title: "Detective Dossier — Detective Conan PH",
  description: "View a detective's watch stats, badges, and profile.",
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const profile = await getProfileByUsername(username)

  if (!profile) {
    notFound()
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isOwn = user?.id === profile.user_id

  const stats = await getProfileStats(profile.user_id)

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 007 — DETECTIVE DOSSIER</span>
          <span className="redacted-bar w-16" />
        </div>

        <ProfileCard profile={profile} isOwn={isOwn} />
        <StatsGrid stats={stats} />
      </div>
    </div>
  )
}
