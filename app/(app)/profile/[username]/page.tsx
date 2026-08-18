import type { Metadata } from "next"
import { ProfileCard } from "@/components/profile/ProfileCard"
import { StatsGrid } from "@/components/profile/StatsGrid"
import { CommentTrail } from "@/components/community/CommentTrail"
import {
  getProfileByUsername,
  getProfileStats,
  getUserComments,
} from "@/lib/queries/profile"
import { createClient } from "@/utils/supabase/server"
import { notFound } from "next/navigation"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}): Promise<Metadata> {
  const { username } = await params
  const profile = await getProfileByUsername(username)

  if (!profile) return {}

  const name = profile.display_name ?? profile.username
  const description = `Detective dossier for ${name}: watch stats, badges, and case notes on Detective Conan PH.`
  const images = [profile.avatar_url ?? "/hero-image.jpg"]

  return {
    title: name,
    description,
    openGraph: {
      title: `${name} | Detective Conan PH`,
      description,
      images,
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title: `${name} | Detective Conan PH`,
      description,
      images,
    },
  }
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
  const { comments: initialComments, hasMore: initialHasMore } = await getUserComments(
    profile.user_id
  )

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="case-number">FILE NO. 007 · DETECTIVE DOSSIER</span>
          <span className="redacted-bar w-16" />
        </div>

        <ProfileCard profile={profile} isOwn={isOwn} />
        <StatsGrid stats={stats} />
        <CommentTrail
          userId={profile.user_id}
          initialComments={initialComments}
          initialHasMore={initialHasMore}
        />
      </div>
    </div>
  )
}
