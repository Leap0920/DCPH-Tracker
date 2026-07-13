"use client"

import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { avatarUrl } from "@/lib/constants"
import { formatDate } from "@/lib/utils"
import type { Database } from "@/types/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]

const roleColors: Record<string, "gold" | "default" | "secondary"> = {
  admin: "gold",
  moderator: "default",
  member: "secondary",
}

export function ProfileCard({ profile }: { profile: Profile }) {
  return (
    <div className="dossier-card p-6 sm:p-8 mb-6">
      <span className="dossier-stamp">Agent</span>

      <div className="flex items-start gap-6 mt-4">
        <Avatar className="h-20 w-20">
          <AvatarImage
            src={profile.avatar_url ?? avatarUrl(profile.display_name)}
          />
          <AvatarFallback className="bg-poison-red text-dossier-cream text-xl font-display">
            {profile.display_name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="font-display text-2xl uppercase tracking-wide text-dossier-cream">
              {profile.display_name}
            </h1>
            <Badge variant={roleColors[profile.role] ?? "secondary"}>
              {profile.role}
            </Badge>
          </div>

          <p className="case-number mb-3">@{profile.username}</p>

          {profile.bio && (
            <p className="text-sm text-dossier-cream-dim max-w-lg">
              {profile.bio}
            </p>
          )}

          <p className="case-number mt-4">
            JOINED {formatDate(profile.created_at)}
          </p>
        </div>
      </div>
    </div>
  )
}
