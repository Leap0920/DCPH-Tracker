import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getWrappedStats } from "@/lib/queries/wrapped"
import { WrappedClient } from "@/components/wrapped/wrapped-client"

export const metadata: Metadata = {
  title: "Wrapped",
  description: "Your Detective Conan watch stats, as a shareable card.",
}

export default async function WrappedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/")

  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, username, display_name, avatar_url")
    .eq("user_id", user.id)
    .single()

  if (!profile) redirect("/")

  const stats = await getWrappedStats(user.id)

  // Proxy the avatar so the canvas export isn't tainted by cross-origin pixels.
  const avatarUrl = profile.avatar_url
    ? `/api/proxy-image?url=${encodeURIComponent(profile.avatar_url)}`
    : null

  const issuedOn = new Date().toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  })

  return (
    <div className="px-4 py-10 sm:px-6 lg:py-16">
      <div className="mx-auto max-w-5xl">
        <WrappedClient
          displayName={profile.display_name || profile.username}
          username={profile.username}
          avatarUrl={avatarUrl}
          stats={stats}
          issuedOn={issuedOn}
        />
      </div>
    </div>
  )
}
