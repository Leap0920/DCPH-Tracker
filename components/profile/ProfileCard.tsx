"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { avatarUrl } from "@/lib/constants"
import { Pencil, Award } from "lucide-react"
import { getDetectiveRank } from "@/lib/ranks"

/**
 * Public-facing profile shape — the PII-safe subset exposed by the
 * `public_profiles` view. NEVER extend this with birthday, bio, status,
 * ban fields, or timestamps: those are private per product decision.
 */
export interface PublicProfile {
  user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  bio?: string | null
}

export function ProfileCard({
  profile,
  isOwn = false,
  casesSolved = 0,
}: {
  profile: PublicProfile
  isOwn?: boolean
  casesSolved?: number
}) {
  const rank = getDetectiveRank(casesSolved)

  return (
    <div className="relative rounded-lg border border-ink-dim/20 bg-surface p-6 shadow-card sm:p-8">
      <span className="dossier-stamp">Detective</span>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <Avatar className="h-24 w-24 shrink-0 ring-2 ring-ink-dim/20">
          <AvatarImage
            src={profile.avatar_url ?? avatarUrl(profile.display_name)}
          />
          <AvatarFallback className="bg-accent text-xl font-display text-white">
            {profile.display_name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl tracking-tight text-ink">
              {profile.display_name}
            </h1>
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 font-mono text-xs font-semibold ${rank.badgeColor}`}
              title={`Level ${rank.level}: ${rank.title}`}
            >
              <Award className="size-3.5 shrink-0" />
              {rank.title}
            </span>
            {isOwn && (
              <Link href="/settings" className="ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-lg border-ink-dim/20 text-ink-dim hover:text-ink"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </Link>
            )}
          </div>

          <p className="mt-1 font-mono text-sm text-ink-faint">
            @{profile.username}
          </p>

          {profile.bio && (
            <p className="mt-3 text-sm leading-relaxed text-ink-dim whitespace-pre-wrap">
              {profile.bio}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
