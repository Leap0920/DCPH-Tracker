"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { createClient } from "@/utils/supabase/client"
import { avatarUrl } from "@/lib/constants"
import { Camera, Trash2, Check, Loader2, LogOut } from "lucide-react"
import type { Database } from "@/types/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]

const MAX_AVATAR_MB = 3

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [bio, setBio] = useState("")
  const [loading, setLoading] = useState(true)
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

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push("/login")
        return
      }

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .single()

      if (data) {
        setProfile(data)
        setDisplayName(data.display_name)
        setBio(data.bio ?? "")
      }

      setLoading(false)
    }

    loadProfile()
  }, [router, supabase])

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

      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName,
          bio: bio || null,
          avatar_url,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", profile.user_id)

      if (error) throw error

      setProfile({
        ...profile,
        display_name: displayName,
        bio: bio || null,
        avatar_url,
      })
      resetAvatar()
      setMessage({ type: "success", text: "Profile updated." })
      router.refresh()
    } catch (err) {
      setUploading(false)
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save changes.",
      })
    }

    setSaving(false)
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
          <p className="font-display text-lg uppercase text-gray-400 animate-pulse">
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
          <span className="case-number">FILE NO. 008 — SETTINGS</span>
          <span className="redacted-bar w-16" />
        </div>

        <h1 className="font-display text-3xl uppercase tracking-wide text-gray-900 mb-8">
          Settings
        </h1>

        {message && (
          <div
            className={`mb-6 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
              message.type === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {message.type === "success" && <Check className="h-4 w-4" />}
            {message.text}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          {/* Profile picture */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="font-display text-base uppercase tracking-wide text-gray-900">
              Profile picture
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Upload your own photo. JPG, PNG or GIF, up to {MAX_AVATAR_MB}MB.
            </p>

            <div className="mt-4 flex items-center gap-5">
              <Avatar className="h-20 w-20 shrink-0 ring-2 ring-gray-200">
                <AvatarImage src={currentAvatarSrc} />
                <AvatarFallback className="bg-[#7A1620] text-lg font-display text-white">
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
                  className="gap-1.5 rounded-lg border-gray-200"
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
                    className="text-gray-500 hover:text-gray-900"
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
                    className="gap-1.5 text-gray-500 hover:text-red-600"
                    onClick={onRemoveAvatar}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>

            {avatarAction === "remove" && (
              <p className="mt-3 text-xs text-gray-400">
                Your photo will be removed when you save.
              </p>
            )}
          </div>

          {/* Identity */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="font-display text-base uppercase tracking-wide text-gray-900">
              Identity
            </h2>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Agent Codename</Label>
                <Input
                  id="username"
                  value={profile?.username ?? ""}
                  disabled
                  className="bg-gray-50 opacity-70"
                />
                <p className="text-xs text-gray-400">
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
                  className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus-visible:border-[#7A1620] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#7A1620]"
                />
                <p className="text-right text-xs text-gray-400">
                  {bio.length}/280
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={saving || uploading}
              className="min-w-[140px] rounded-lg"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </form>

        {/* Account */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="font-display text-base uppercase tracking-wide text-gray-900">
            Account
          </h2>
          <div className="mt-4">
            <Button
              variant="outline"
              onClick={handleSignOut}
              className="gap-1.5 rounded-lg border-gray-200 text-gray-600 hover:text-gray-900"
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
