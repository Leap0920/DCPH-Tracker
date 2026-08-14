"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth/admin"
import { createAdminClient } from "@/utils/supabase/admin"
import type { Database } from "@/types/database.types"

type ArcInsert = Database["public"]["Tables"]["arcs"]["Insert"]

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function toNullableInt(value: FormDataEntryValue | null): number | null {
  if (value === null) return null
  const s = String(value).trim()
  if (s === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function buildArcPayload(formData: FormData): { payload: ArcInsert } | { error: string } {
  const title = String(formData.get("title") ?? "").trim()
  if (!title) return { error: "Title is required." }

  let slug = String(formData.get("slug") ?? "").trim()
  if (!slug) slug = slugify(title)
  if (!slug) return { error: "Slug is required." }

  const startEpisode = toNullableInt(formData.get("start_episode"))
  const endEpisode = toNullableInt(formData.get("end_episode"))

  if (startEpisode === null || startEpisode < 1) return { error: "Valid start episode is required." }
  if (endEpisode === null || endEpisode < startEpisode) return { error: "End episode must be >= start episode." }

  const payload: ArcInsert = {
    slug,
    title,
    description: String(formData.get("description") ?? "").trim() || null,
    image_url: String(formData.get("image_url") ?? "").trim() || null,
    start_episode: startEpisode,
    end_episode: endEpisode,
  }

  return { payload }
}

export async function createArc(formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }

  const built = buildArcPayload(formData)
  if ("error" in built) return { ok: false, error: built.error }

  const { error } = await admin.from("arcs").insert(built.payload)
  if (error) {
    if (error.code === "23505") return { ok: false, error: "An arc with this slug already exists." }
    return { ok: false, error: error.message }
  }

  revalidatePath("/admin/arcs")
  revalidatePath("/tracker")
  return { ok: true, message: "Story arc created." }
}

export async function updateArc(id: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }
  if (!id) return { ok: false, error: "Missing arc ID." }

  const built = buildArcPayload(formData)
  if ("error" in built) return { ok: false, error: built.error }

  const { error } = await admin
    .from("arcs")
    .update(built.payload)
    .eq("id", id)

  if (error) {
    if (error.code === "23505") return { ok: false, error: "An arc with this slug already exists." }
    return { ok: false, error: error.message }
  }

  revalidatePath("/admin/arcs")
  revalidatePath("/tracker")
  return { ok: true, message: "Story arc updated." }
}

export async function deleteArc(id: string): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }
  if (!id) return { ok: false, error: "Missing arc ID." }

  const { error } = await admin.from("arcs").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/arcs")
  revalidatePath("/tracker")
  return { ok: true, message: "Story arc deleted." }
}
