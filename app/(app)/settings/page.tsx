"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/utils/supabase/client"
import type { Database } from "@/types/database.types"

type Profile = Database["public"]["Tables"]["profiles"]["Row"]

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState("")
  const [bio, setBio] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
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
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return

    setSaving(true)
    setMessage(null)

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName,
        bio: bio || null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", profile.user_id)

    if (error) {
      setMessage("Failed to save changes.")
    } else {
      setMessage("Profile updated successfully.")
    }

    setSaving(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="case-number">FILE NO. 008 — SETTINGS</span>
          <span className="redacted-bar w-16" />
        </div>

        <h1 className="font-display text-3xl uppercase tracking-wide text-dossier-cream mb-8">
          Settings
        </h1>

        {loading ? (
          <div className="text-center py-16">
            <p className="font-display text-lg uppercase text-silver-steel animate-pulse">
              Loading settings...
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Agent Profile</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSave} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">Agent Codename</Label>
                    <Input
                      id="username"
                      value={profile?.username ?? ""}
                      disabled
                      className="opacity-50"
                    />
                    <p className="text-xs text-dossier-cream-dim">
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
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bio">Bio</Label>
                    <Input
                      id="bio"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="Tell us about yourself..."
                    />
                  </div>

                  {message && (
                    <p className={`text-sm ${message.includes("Failed") ? "text-poison-red-bright" : "text-green-500"}`}>
                      {message}
                    </p>
                  )}

                  <Button type="submit" disabled={saving}>
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Account</CardTitle>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={handleSignOut}>
                  Sign Out
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
