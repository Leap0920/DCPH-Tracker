"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { createClient } from "@/utils/supabase/client"
import { openAuthModal } from "@/lib/auth-modal"
import { avatarUrl } from "@/lib/constants"
import { queryKeys } from "@/lib/queries/keys"
import {
  fetchProfileByUserId,
  updateProfile,
} from "@/lib/queries/client/profile"
import { Camera, Trash2, Check, Loader2, LogOut } from "lucide-react"
import type { Database } from "@/types/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]

const MAX_AVATAR_MB = 3

export default function SettingsPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [bio, setBio] = useState("")
  const [birthday, setBirthday] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  // Avatar editor state
  const [avatarAction, setAvatarAction] = useState<"none" | "new" | "remove">(
    "none"
  )
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const router = useRouter()
  const supabase = createClient()
  const queryClient = useQueryClient()

  // Auth (one-time, not cacheable data) — gates the profile query.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id)
        setEmail(data.user.email ?? null)
      } else openAuthModal("signin")
    })
  }, [router, supabase])

  // Profile query
  const profileQuery = useQuery({
    queryKey: queryKeys.profile.byId(userId ?? ""),
    queryFn: () => fetchProfileByUserId(userId as string),
    enabled: !!userId,
  })
  const profile = profileQuery.data ?? null

  // Sync form fields once when the profile arrives.
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name)
      setBio(profile.bio ?? "")
      setBirthday(profile.birthday ?? null)
    }
  }, [profile])

  const updateProfileMutation = useMutation({
    mutationFn: (updates: Database["public"]["Tables"]["profiles"]["Update"]) =>
      updateProfile(userId as string, updates),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.profile.byId(userId as string), data)
      resetAvatar()
      setMessage({ type: "success", text: "Profile updated." })
      router.refresh()
    },
    onError: (err) => {
      setUploading(false)
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save changes.",
      })
    },
  })

  const loading = !userId || profileQuery.isLoading

  const currentAvatarSrc =
    previewUrl ?? profile?.avatar_url ?? avatarUrl(displayName || "?")
  const avatarChanged = avatarAction !== "none"

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      setMessage({ type: "error", text: "Please choose an image file." })
      return
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      setMessage({
        type: "error",
        text: `Image must be ${MAX_AVATAR_MB}MB or smaller.`,
      })
      return
    }

    setMessage(null)
    setPendingFile(file)
    setAvatarAction("new")
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
  }

  function onRemoveAvatar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPendingFile(null)
    setAvatarAction("remove")
    setMessage(null)
  }

  function resetAvatar() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPendingFile(null)
    setAvatarAction("none")
  }

  async function deleteOldAvatar(url: string | null) {
    if (!url) return
    try {
      const marker = "/object/public/avatars/"
      const idx = url.indexOf(marker)
      if (idx === -1) return
      const path = url.slice(idx + marker.length)
      await supabase.storage.from("avatars").remove([path])
    } catch {
      // best-effort cleanup; ignore failures
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!profile || saving) return

    setSaving(true)
    setMessage(null)

    try {
      let avatar_url = profile.avatar_url

      if (avatarAction === "new" && pendingFile) {
        setUploading(true)
        const ext = pendingFile.name.split(".").pop() ?? "png"
        const path = `${profile.user_id}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, pendingFile, { cacheControl: "3600", upsert: true })

        setUploading(false)
        if (uploadError) throw uploadError

        const { data: urlData } = supabase.storage
          .from("avatars")
          .getPublicUrl(path)
        avatar_url = urlData.publicUrl

        await deleteOldAvatar(profile.avatar_url)
      } else if (avatarAction === "remove") {
        await deleteOldAvatar(profile.avatar_url)
        avatar_url = null
      }

      updateProfileMutation.mutate({
        display_name: displayName,
        bio: bio || null,
        birthday: birthday || null,
        avatar_url,
      })
      // The mutation's isPending now guards the button; `saving` only
      // covers the sync avatar-upload phase above.
      setSaving(false)
    } catch (err) {
      setUploading(false)
      setSaving(false)
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save changes.",
      })
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  if (loading) {
    return (
      <div className="px-6 py-10">
        <div className="mx-auto max-w-2xl text-center py-16">
          <p className="font-display text-lg tracking-tight text-ink-faint animate-pulse">
            Loading settings...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="case-number">FILE NO. 008 · SETTINGS</span>
          <span className="redacted-bar w-16" />
        </div>

        <h1 className="font-display text-3xl tracking-tight text-ink mb-8">
          Settings
        </h1>

        {message && (
          <div
            className={`mb-6 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
              message.type === "success"
                ? "border-success/30 bg-success/10 text-success"
                : "border-danger/30 bg-danger/10 text-danger"
            }`}
          >
            {message.type === "success" && <Check className="h-4 w-4" />}
            {message.text}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          {/* Profile picture */}
          <div className="rounded-lg border border-line bg-surface p-6 shadow-card">
            <h2 className="font-display text-base tracking-tight text-ink">
              Profile picture
            </h2>
            <p className="mt-1 text-sm text-ink-dim">
              Upload your own photo. JPG, PNG or GIF, up to {MAX_AVATAR_MB}MB.
            </p>

            <div className="mt-4 flex items-center gap-5">
              <Avatar className="h-20 w-20 shrink-0 ring-2 ring-line">
                <AvatarImage src={currentAvatarSrc} />
                <AvatarFallback className="bg-accent text-lg font-display text-white">
                  {(displayName || "?").slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 min-h-9 rounded-lg border-line"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4" />
                  )}
                  {avatarAction === "new" ? "Change" : "Upload"}
                </Button>

                {avatarChanged && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-ink-dim hover:text-ink"
                    onClick={resetAvatar}
                  >
                    Cancel
                  </Button>
                )}

                {profile?.avatar_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-ink-dim hover:text-danger"
                    onClick={onRemoveAvatar}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>

            {avatarAction === "remove" && (
              <p className="mt-3 text-xs text-ink-faint">
                Your photo will be removed when you save.
              </p>
            )}
          </div>

          {/* Identity */}
          <div className="rounded-lg border border-line bg-surface p-6 shadow-card">
            <h2 className="font-display text-base tracking-tight text-ink">
              Identity
            </h2>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Detective Codename</Label>
                <Input
                  id="username"
                  value={profile?.username ?? ""}
                  disabled
                  className="bg-surface-muted opacity-70"
                />
                <p className="text-xs text-ink-faint">
                  Codename cannot be changed.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  maxLength={50}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bio">Bio</Label>
                <textarea
                  id="bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell us about yourself..."
                  rows={3}
                  maxLength={280}
                  className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                />
                <p className="text-right text-xs text-ink-faint">
                  {bio.length}/280
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="birthday">Birthday</Label>
                <Input
                  id="birthday"
                  type="date"
                  value={birthday ?? ""}
                  onChange={(e) => setBirthday(e.target.value || null)}
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={saving || uploading || updateProfileMutation.isPending}
              className="min-w-[140px] rounded-lg"
            >
              {saving || updateProfileMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </form>

        {/* Account */}
        <div className="mt-6 rounded-lg border border-line bg-surface p-6 shadow-card">
          <h2 className="font-display text-base tracking-tight text-ink">
            Account
          </h2>

          <dl className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-ink-faint">Email</dt>
              <dd className="text-sm text-ink-dim">
                {email ?? "Not provided"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-ink-faint">Member since</dt>
              <dd className="text-sm text-ink-dim">
                {profile
                  ? new Date(profile.created_at).toLocaleDateString("en-PH", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : ""}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-ink-faint">Role</dt>
              <dd className="text-sm text-ink-dim">
                {profile
                  ? profile.role.charAt(0).toUpperCase() +
                    profile.role.slice(1)
                  : ""}
              </dd>
            </div>
          </dl>

          <div className="mt-4">
            <Button
              variant="outline"
              onClick={handleSignOut}
              className="gap-1.5 rounded-lg border-line text-ink-dim hover:text-ink"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}