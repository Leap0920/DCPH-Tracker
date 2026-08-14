"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth/admin"
import { createAdminClient } from "@/utils/supabase/admin"
import type { Database } from "@/types/database.types"

type BadgeInsert = Database["public"]["Tables"]["badges"]["Insert"]

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function buildBadgePayload(formData: FormData): { payload: BadgeInsert } | { error: string } {
  const name = String(formData.get("name") ?? "").trim()
  if (!name) return { error: "Badge name is required." }

  let slug = String(formData.get("slug") ?? "").trim()
  if (!slug) slug = slugify(name)
  if (!slug) return { error: "Slug is required." }

  const category = String(formData.get("category") ?? "").trim() || "achievement"

  const payload: BadgeInsert = {
    slug,
    name,
    description: String(formData.get("description") ?? "").trim() || null,
    icon_url: String(formData.get("icon_url") ?? "").trim() || null,
    category,
  }

  return { payload }
}

export async function createBadge(formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }

  const built = buildBadgePayload(formData)
  if ("error" in built) return { ok: false, error: built.error }

  const { error } = await admin.from("badges").insert(built.payload)
  if (error) {
    if (error.code === "23505") return { ok: false, error: "A badge with this slug already exists." }
    return { ok: false, error: error.message }
  }

  revalidatePath("/admin/badges")
  return { ok: true, message: "Badge created." }
}

export async function updateBadge(id: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }
  if (!id) return { ok: false, error: "Missing badge ID." }

  const built = buildBadgePayload(formData)
  if ("error" in built) return { ok: false, error: built.error }

  const { error } = await admin
    .from("badges")
    .update(built.payload)
    .eq("id", id)

  if (error) {
    if (error.code === "23505") return { ok: false, error: "A badge with this slug already exists." }
    return { ok: false, error: error.message }
  }

  revalidatePath("/admin/badges")
  return { ok: true, message: "Badge updated." }
}

export async function deleteBadge(id: string): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }
  if (!id) return { ok: false, error: "Missing badge ID." }

  const { error } = await admin.from("badges").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/badges")
  return { ok: true, message: "Badge deleted." }
}
