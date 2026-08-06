"use client"

import { useState, useTransition, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Upload, X, Loader2, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import type { Database } from "@/types/database.types"
import type { ActionResult } from "@/lib/actions/admin-content"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

const TYPE_OPTIONS = Object.entries(CONTENT_TYPE_LABELS) as [ContentType, string][]

const inputCls =
  "w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900"
const labelCls =
  "block font-display text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5"

export function ContentForm({
  entry,
  action,
}: {
  entry?: ContentEntry
  action: (formData: FormData) => Promise<ActionResult>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState<ContentType>((entry?.type as ContentType) ?? "episode")
  const [preview, setPreview] = useState<string | null>(entry?.image_url ?? null)
  const fileRef = useRef<HTMLInputElement>(null)

  const isEpisode = type === "episode"
  const isMovie = type === "movie"

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setPreview(URL.createObjectURL(file))
  }

  function clearFile() {
    if (fileRef.current) fileRef.current.value = ""
    setPreview(entry?.image_url ?? null)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await action(formData)
      if (result.ok) {
        router.push("/admin/content")
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/content"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to content
      </Link>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div>
          <label className={labelCls}>Title</label>
          <input name="title" defaultValue={entry?.title ?? ""} required className={inputCls} placeholder="Episode / movie title" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Type</label>
            <select
              name="type"
              value={type}
              onChange={(e) => setType(e.target.value as ContentType)}
              className={inputCls}
            >
              {TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Air date</label>
            <input type="date" name="air_date" defaultValue={entry?.air_date ?? ""} required className={inputCls} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {isEpisode && (
            <div>
              <label className={labelCls}>Episode #</label>
              <input type="number" name="episode_number" defaultValue={entry?.episode_number ?? ""} className={inputCls} />
            </div>
          )}
          {isMovie && (
            <div>
              <label className={labelCls}>Movie #</label>
              <input type="number" name="movie_number" defaultValue={entry?.movie_number ?? ""} className={inputCls} />
            </div>
          )}
          <div>
            <label className={labelCls}>Canon order</label>
            <input type="number" name="canon_order" defaultValue={entry?.canon_order ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Release order</label>
            <input type="number" name="release_order" defaultValue={entry?.release_order ?? ""} className={inputCls} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Runtime (min)</label>
            <input type="number" name="runtime_minutes" defaultValue={entry?.runtime_minutes ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Slug (optional)</label>
            <input name="slug" defaultValue={entry?.slug ?? ""} className={inputCls} placeholder="auto from title" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Synopsis</label>
          <textarea
            name="synopsis"
            defaultValue={entry?.synopsis ?? ""}
            rows={4}
            className={cn(inputCls, "h-auto py-2 resize-y")}
            placeholder="Short description…"
          />
        </div>

        {/* Cover image */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <label className={labelCls}>Cover image</label>
          <div className="flex items-start gap-4">
            <div className="h-24 w-36 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white flex items-center justify-center">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[10px] font-mono uppercase text-gray-300">No cover</span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <input
                name="image_url"
                defaultValue={entry?.image_url ?? ""}
                onChange={(e) => setPreview(e.target.value || null)}
                className={inputCls}
                placeholder="Paste an image URL…"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-300 text-xs font-medium text-gray-600 hover:text-gray-900 hover:border-gray-400"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload file
                </button>
                {fileRef.current?.value && (
                  <button
                    type="button"
                    onClick={clearFile}
                    className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  name="cover_file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={onFileChange}
                  className="hidden"
                />
              </div>
              <p className="text-[11px] text-gray-400">
                Uploading a file overrides the URL. Max 5 MB (JPEG, PNG, WEBP, GIF).
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-gray-900 text-sm font-display uppercase tracking-wide text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {entry ? "Save changes" : "Create entry"}
          </button>
          <Link
            href="/admin/content"
            className="h-10 inline-flex items-center px-5 rounded-lg border border-gray-200 text-sm font-display uppercase tracking-wide text-gray-500 hover:text-gray-900"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
