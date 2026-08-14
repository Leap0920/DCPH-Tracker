"use client"

import { useState, useTransition, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Upload, X, Loader2, ArrowLeft, Image as ImageIcon, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import type { Database } from "@/types/database.types"
import { resolveWikiImageUrl, type ActionResult } from "@/lib/actions/admin-content"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

const TYPE_OPTIONS = Object.entries(CONTENT_TYPE_LABELS) as [ContentType, string][]

const inputCls =
  "w-full h-10 rounded-lg border border-slate-200 bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
const labelCls =
  "block font-display text-xs font-semibold text-ink-dim mb-1.5"

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

  // Controlled cover image states
  const [imageUrl, setImageUrl] = useState<string>(entry?.image_url ?? "")
  const [preview, setPreview] = useState<string | null>(entry?.image_url ?? null)
  const [isResolving, setIsResolving] = useState<boolean>(false)
  const [imageLoadError, setImageLoadError] = useState<boolean>(false)
  const [fileName, setFileName] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)

  const isEpisode = type === "episode"
  const isMovie = type === "movie"

  async function processUrlInput(url: string) {
    setImageLoadError(false)
    setImageUrl(url)

    if (!url.trim()) {
      setPreview(null)
      return
    }

    if (url.includes("/wiki/File:")) {
      setIsResolving(true)
      try {
        const resolved = await resolveWikiImageUrl(url)
        if (resolved) {
          setImageUrl(resolved)
          setPreview(resolved)
        }
      } catch {
        setPreview(url)
      } finally {
        setIsResolving(false)
      }
    } else {
      setPreview(url.trim())
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) {
      setImageLoadError(false)
      setFileName(file.name)
      setPreview(URL.createObjectURL(file))
      setImageUrl("") // file upload takes priority over text URL
    }
  }

  function clearFile() {
    if (fileRef.current) fileRef.current.value = ""
    setFileName(null)
    setImageUrl(entry?.image_url ?? "")
    setPreview(entry?.image_url ?? null)
    setImageLoadError(false)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const formEl = e.currentTarget
    const formData = new FormData(formEl)
    
    // Ensure resolved imageUrl is passed in formData if input wasn't updated in DOM
    formData.set("image_url", imageUrl)

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
        className="inline-flex items-center gap-2 text-sm text-ink-dim hover:text-ink mb-4 font-display"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to content
      </Link>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className={labelCls}>Title *</label>
          <input
            name="title"
            defaultValue={entry?.title ?? ""}
            required
            className={inputCls}
            placeholder="e.g. The Timed Skyscraper"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Type *</label>
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
            <label className={labelCls}>Air Date *</label>
            <input
              type="date"
              name="air_date"
              defaultValue={entry?.air_date ?? ""}
              required
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {isEpisode && (
            <div>
              <label className={labelCls}>Episode #</label>
              <input
                type="number"
                name="episode_number"
                defaultValue={entry?.episode_number ?? ""}
                className={inputCls}
                placeholder="1"
              />
            </div>
          )}
          {isMovie && (
            <div>
              <label className={labelCls}>Movie #</label>
              <input
                type="number"
                name="movie_number"
                defaultValue={entry?.movie_number ?? ""}
                className={inputCls}
                placeholder="1 - 29"
              />
            </div>
          )}
          <div>
            <label className={labelCls}>Canon Order</label>
            <input
              type="number"
              name="canon_order"
              defaultValue={entry?.canon_order ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Release Order</label>
            <input
              type="number"
              name="release_order"
              defaultValue={entry?.release_order ?? ""}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Runtime (min)</label>
            <input
              type="number"
              name="runtime_minutes"
              defaultValue={entry?.runtime_minutes ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Slug (optional)</label>
            <input
              name="slug"
              defaultValue={entry?.slug ?? ""}
              className={inputCls}
              placeholder="auto from title"
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Synopsis</label>
          <textarea
            name="synopsis"
            defaultValue={entry?.synopsis ?? ""}
            rows={4}
            className={cn(inputCls, "h-auto py-2 resize-y")}
            placeholder="Short description..."
          />
        </div>

        {/* Cover image section */}
        <div className="rounded-xl border border-slate-200 bg-surface-muted p-5 space-y-4">
          <div className="flex items-center justify-between">
            <label className={labelCls}>Cover Image Poster</label>
            {isResolving && (
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-amber-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Resolving Wiki image link...
              </span>
            )}
          </div>

          <div className="flex items-start gap-4">
            <div className="h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-surface flex flex-col items-center justify-center relative">
              {preview && !imageLoadError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Cover preview"
                  onError={() => setImageLoadError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="p-2 text-center text-ink-faint">
                  <ImageIcon className="mx-auto h-6 w-6 mb-1 opacity-50" />
                  <span className="text-[10px] font-mono block">
                    {imageLoadError ? "Invalid URL" : "No Cover"}
                  </span>
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <input
                  name="image_url"
                  value={imageUrl}
                  onChange={(e) => processUrlInput(e.target.value)}
                  onBlur={(e) => processUrlInput(e.target.value)}
                  className={inputCls}
                  placeholder="Paste direct image URL or Wiki File page link..."
                />
                {imageLoadError && (
                  <p className="text-[11px] text-red-500 mt-1 font-mono">
                    Unable to load image from URL. Please check the link or upload a file.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-300 bg-surface text-xs font-medium text-ink-dim hover:text-ink hover:border-slate-400 shadow-sm"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {fileName ? "Change File" : "Upload File"}
                </button>

                {(fileName || imageUrl) && (
                  <button
                    type="button"
                    onClick={clearFile}
                    className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-red-600 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                )}

                {fileName && (
                  <span className="font-mono text-xs text-green-700 truncate max-w-xs">
                    File: {fileName}
                  </span>
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

              <p className="text-[11px] text-ink-faint">
                Supports direct image URLs, Detective Conan Wiki File pages, or disk upload (max 5 MB).
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={pending || isResolving}
            className="inline-flex items-center gap-2 h-10 px-6 rounded-lg bg-gray-900 text-sm font-display text-white hover:bg-gray-800 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {entry ? "Save changes" : "Create entry"}
          </button>
          <Link
            href="/admin/content"
            className="h-10 inline-flex items-center px-5 rounded-lg border border-slate-200 text-sm font-display text-ink-dim hover:text-ink"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
