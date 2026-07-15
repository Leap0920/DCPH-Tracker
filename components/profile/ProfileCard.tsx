"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { avatarUrl } from "@/lib/constants"
import { formatDate } from "@/lib/utils"
import { Pencil } from "lucide-react"
import type { Database } from "@/types/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]

const roleColors: Record<string, "gold" | "default" | "secondary"> = {
  admin: "gold",
  moderator: "default",
  member: "secondary",
}

export function ProfileCard({
  profile,
  isOwn = false,
}: {
  profile: Profile
  isOwn?: boolean
}) {
  return (
    <div className="relative rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
      <span className="dossier-stamp">Agent</span>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <Avatar className="h-24 w-24 shrink-0 ring-2 ring-gray-200">
          <AvatarImage
            src={profile.avatar_url ?? avatarUrl(profile.display_name)}
          />
          <AvatarFallback className="bg-[#7A1620] text-xl font-display text-white">
            {profile.display_name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl uppercase tracking-wide text-gray-900">
              {profile.display_name}
            </h1>
            <Badge variant={roleColors[profile.role] ?? "secondary"}>
              {profile.role}
            </Badge>
            {isOwn && (
              <Link href="/settings" className="ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-lg border-gray-200 text-gray-600 hover:text-gray-900"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </Link>
            )}
          </div>

          <p className="mt-1 font-mono text-sm text-gray-400">
            @{profile.username}
          </p>

          {profile.bio && (
            <p className="mt-4 max-w-lg text-sm text-gray-600">
              {profile.bio}
            </p>
          )}

          <p className="mt-4 font-mono text-xs uppercase tracking-wide text-gray-400">
            Joined {formatDate(profile.created_at)}
          </p>
        </div>
      </div>
    </div>
  )
}
