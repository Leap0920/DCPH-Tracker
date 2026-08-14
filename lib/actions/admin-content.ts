"use server"

import { revalidatePath } from "next/cache"
import { requireAdmin } from "@/lib/auth/admin"
import { createAdminClient } from "@/utils/supabase/admin"
import type { Database } from "@/types/database.types"

type ContentInsert = Database["public"]["Tables"]["content_entries"]["Insert"]
type ContentType = Database["public"]["Tables"]["content_entries"]["Row"]["type"]

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

const CONTENT_TYPES: ContentType[] = [
  "episode",
  "movie",
  "special",
  "ova",
  "live_action",
  "magic_kaito",
  "hanzawa",
  "zero_tea_time",
  "yaiba",
]

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB

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

/**
 * Uploads an image file to the content-images bucket and returns its public URL.
 * Returns null if no file was provided.
 */
async function uploadCover(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  file: File | null
): Promise<{ url: string } | { error: string } | null> {
  if (!file || file.size === 0) return null

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { error: "Cover must be a JPEG, PNG, WEBP, or GIF image." }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: "Cover image must be 5 MB or smaller." }
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg"
  const path = `covers/${crypto.randomUUID()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error } = await admin.storage
    .from("content-images")
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (error) return { error: `Image upload failed: ${error.message}` }

  const { data } = admin.storage.from("content-images").getPublicUrl(path)
  return { url: data.publicUrl }
}

/**
 * Builds a content row payload from submitted form data. Returns either the
 * payload or a validation error.
 */
async function buildPayload(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  formData: FormData
): Promise<{ payload: ContentInsert } | { error: string }> {
  const title = String(formData.get("title") ?? "").trim()
  const type = String(formData.get("type") ?? "") as ContentType
  const airDate = String(formData.get("air_date") ?? "").trim()

  if (!title) return { error: "Title is required." }
  if (!CONTENT_TYPES.includes(type)) return { error: "A valid content type is required." }
  if (!airDate) return { error: "Air date is required." }

  let slug = String(formData.get("slug") ?? "").trim()
  if (!slug) slug = slugify(title)
  if (!slug) return { error: "Could not derive a slug; please provide one." }

  const canonOrder = toNullableInt(formData.get("canon_order"))

  // Resolve cover: uploaded file takes priority over pasted URL.
  const file = formData.get("cover_file")
  let imageUrl = String(formData.get("image_url") ?? "").trim() || null
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadCover(admin, file)
    if (uploaded && "error" in uploaded) return { error: uploaded.error }
    if (uploaded && "url" in uploaded) imageUrl = uploaded.url
  }

  const payload: ContentInsert = {
    slug,
    title,
    type,
    air_date: airDate,
    canon_order: canonOrder ?? 0,
    episode_number: toNullableInt(formData.get("episode_number")),
    movie_number: toNullableInt(formData.get("movie_number")),
    release_order: toNullableInt(formData.get("release_order")),
    runtime_minutes: toNullableInt(formData.get("runtime_minutes")),
    synopsis: String(formData.get("synopsis") ?? "").trim() || null,
    image_url: imageUrl,
  }

  return { payload }
}

export async function createContentEntry(formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }

  const built = await buildPayload(admin, formData)
  if ("error" in built) return { ok: false, error: built.error }

  const { error } = await admin.from("content_entries").insert(built.payload)
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That slug already exists. Choose a unique slug." }
    return { ok: false, error: error.message }
  }

  revalidatePath("/admin/content")
  revalidatePath("/tracker")
  return { ok: true, message: "Entry created." }
}

export async function updateContentEntry(id: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }
  if (!id) return { ok: false, error: "Missing entry id." }

  const built = await buildPayload(admin, formData)
  if ("error" in built) return { ok: false, error: built.error }

  const { error } = await admin
    .from("content_entries")
    .update(built.payload)
    .eq("id", id)
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That slug is already used by another entry." }
    return { ok: false, error: error.message }
  }

  revalidatePath("/admin/content")
  revalidatePath("/tracker")
  return { ok: true, message: "Entry updated." }
}

export async function deleteContentEntry(id: string): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }
  if (!id) return { ok: false, error: "Missing entry id." }

  const { error } = await admin.from("content_entries").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/content")
  revalidatePath("/tracker")
  return { ok: true, message: "Entry deleted." }
}

/**
 * Updates only the cover image for an entry (quick-fix flow from the list).
 */
export async function updateContentCover(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }
  if (!id) return { ok: false, error: "Missing entry id." }

  let imageUrl = String(formData.get("image_url") ?? "").trim() || null
  const file = formData.get("cover_file")
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadCover(admin, file)
    if (uploaded && "error" in uploaded) return { ok: false, error: uploaded.error }
    if (uploaded && "url" in uploaded) imageUrl = uploaded.url
  }

  const { error } = await admin
    .from("content_entries")
    .update({ image_url: imageUrl })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/content")
  revalidatePath("/admin/content/covers")
  revalidatePath("/tracker")
  return { ok: true, message: "Cover updated." }
}

/**
 * Updates only the content type (category) for an entry (quick relocation flow).
 */
export async function updateContentType(
  id: string,
  newType: ContentType
): Promise<ActionResult> {
  await requireAdmin()
  const admin = createAdminClient()
  if (!admin) return { ok: false, error: "Service role key not configured." }
  if (!id) return { ok: false, error: "Missing entry id." }
  if (!CONTENT_TYPES.includes(newType)) {
    return { ok: false, error: "Invalid content type category." }
  }

  const { error } = await admin
    .from("content_entries")
    .update({ type: newType })
    .eq("id", id)

  if (error) return { ok: false, error: error.message }

  revalidatePath("/admin/content")
  revalidatePath("/tracker")
  return { ok: true, message: `Category moved to ${newType}.` }
}
