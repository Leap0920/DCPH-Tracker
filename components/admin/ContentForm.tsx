"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Upload,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { CONTENT_TYPE_LABELS, type ContentType } from "@/lib/constants"
import { cleanImageUrl } from "@/lib/utils/image-url"
import type { Database } from "@/types/database.types"
import { resolveWikiImageUrl, type ActionResult } from "@/lib/actions/admin-content"
import { CrimeTypeSelector } from "@/components/admin/CrimeTypeSelector"
import { normalizeCrimeSlugs, type CrimeSlug } from "@/lib/crime-categories"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]
type CopyKey = "raw" | "clean"

const TYPE_OPTIONS = Object.entries(CONTENT_TYPE_LABELS) as [ContentType, string][]

const inputCls =
  "w-full h-10 rounded-md border border-ink-dim/20 bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
const labelCls = "block font-display text-xs font-semibold text-ink-dim mb-1.5"
const ghostBtnCls =
  "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-ink-dim/20 bg-surface text-[11px] font-medium text-ink-dim transition-colors hover:text-ink hover:border-ink-dim/40 disabled:opacity-40 disabled:pointer-events-none"

function isWikiFilePage(url: string): boolean {
  return /\/wiki\/File:/i.test(url)
}

/** Clipboard write with a fallback for non-secure contexts / older browsers. */
async function copyText(value: string): Promise<boolean> {
  if (!value) return false

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const ta = document.createElement("textarea")
    ta.value = value
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.top = "-1000px"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function UrlRow({
  label,
  hint,
  value,
  copyLabel,
  copied,
  onCopy,
  emphasis = false,
}: {
  label: string
  hint?: string
  value: string
  copyLabel: string
  copied: boolean
  onCopy: () => void
  emphasis?: boolean
}) {
  const hasValue = value.trim().length > 0

  return (
    <div
      className={cn(
        "rounded-md border bg-surface px-3 py-2",
        emphasis ? "border-accent/25" : "border-ink-dim/15"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {hasValue && (
            <a
              href={value}
              target="_blank"
              rel="noreferrer noopener"
              title="Open in a new tab"
              className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] text-ink-faint transition-colors hover:text-ink"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </a>
          )}
          <button
            type="button"
            onClick={onCopy}
            disabled={!hasValue}
            aria-label={copyLabel}
            title={copyLabel}
            className={ghostBtnCls}
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-green-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                {copyLabel}
              </>
            )}
          </button>
        </div>
      </div>

      <p
        className={cn(
          "mt-1 break-all font-mono text-[11px] leading-relaxed",
          hasValue ? "text-ink-dim" : "text-ink-faint"
        )}
      >
        {hasValue ? value : "ΓÇö"}
      </p>

      {hint && <p className="mt-1 text-[10px] text-ink-faint">{hint}</p>}
    </div>
  )
}

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

  const initialUrl = entry?.image_url ?? ""

  // Cover image state: raw pasted link vs cleaned/resolved link.
  const [rawUrl, setRawUrl] = useState<string>(initialUrl)
  const [cleanUrl, setCleanUrl] = useState<string>(() => cleanImageUrl(initialUrl) ?? "")
  const [isResolving, setIsResolving] = useState<boolean>(false)
  const [resolveNote, setResolveNote] = useState<string | null>(null)
  const [imageLoadError, setImageLoadError] = useState<boolean>(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)
  const [copied, setCopied] = useState<CopyKey | null>(null)
  const [copyStatus, setCopyStatus] = useState<string>("")
  const [crimeTypes, setCrimeTypes] = useState<CrimeSlug[]>(() =>
    normalizeCrimeSlugs((entry as unknown as { crime_types?: string[] })?.crime_types),
  )

  const fileRef = useRef<HTMLInputElement>(null)
  const resolveSeq = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isEpisode = type === "episode"
  const isMovie = type === "movie"

  const trimmedRaw = rawUrl.trim()
  const effectiveUrl = cleanUrl || trimmedRaw
  const previewSrc = filePreview ?? (effectiveUrl || null)
  const hasUrl = trimmedRaw.length > 0
  const needsResolve = isWikiFilePage(effectiveUrl)
  const cleanDiffers = cleanUrl.length > 0 && cleanUrl !== trimmedRaw

  // Revoke the previous object URL whenever the file preview changes or on unmount.
  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview)
    }
  }, [filePreview])

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])

  // A new preview source deserves a fresh chance to load.
  useEffect(() => {
    setImageLoadError(false)
  }, [previewSrc])

  function applyUrl(value: string) {
    setRawUrl(value)
    setCleanUrl(cleanImageUrl(value) ?? "")
    setResolveNote(null)

    // Typing a URL means the user is not uploading a file.
    if (fileRef.current) fileRef.current.value = ""
    setFileName(null)
    setFilePreview(null)
  }

  async function resolveNow(value: string) {
    const target = value.trim()
    if (!target || !isWikiFilePage(target)) return

    const seq = ++resolveSeq.current
    setIsResolving(true)
    setResolveNote(null)

    try {
      const resolved = await resolveWikiImageUrl(target)
      if (seq !== resolveSeq.current) return

      const next = cleanImageUrl(resolved) ?? ""
      if (next && !isWikiFilePage(next)) {
        setCleanUrl(next)
      } else {
        setCleanUrl(cleanImageUrl(target) ?? target)
        setResolveNote(
          "Could not extract a direct image from that Wiki page. Try right-click ΓåÆ Copy image address on the full-size image."
        )
      }
    } catch {
      if (seq !== resolveSeq.current) return
      setResolveNote("Resolving failed. The link will still be cleaned on save.")
    } finally {
      if (seq === resolveSeq.current) setIsResolving(false)
    }
  }

  function onUrlPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text")
    if (!pasted) return
    e.preventDefault()
    applyUrl(pasted.trim())
    if (isWikiFilePage(pasted)) void resolveNow(pasted)
  }

  function useCleanInField() {
    if (!cleanUrl) return
    setRawUrl(cleanUrl)
  }

  async function handleCopy(key: CopyKey, value: string) {
    const ok = await copyText(value.trim())
    if (copyTimer.current) clearTimeout(copyTimer.current)

    if (ok) {
      setCopied(key)
      setCopyStatus(key === "raw" ? "Link address copied." : "Clean link copied.")
      copyTimer.current = setTimeout(() => {
        setCopied(null)
        setCopyStatus("")
      }, 1600)
    } else {
      setCopied(null)
      setCopyStatus("Copy failed ΓÇö select the link and copy manually.")
      copyTimer.current = setTimeout(() => setCopyStatus(""), 2600)
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setFilePreview(URL.createObjectURL(file))
    setResolveNote(null)

    // File upload wins on the server, so drop the URL to keep one source of truth.
    setRawUrl("")
    setCleanUrl("")
  }

  function removeFile() {
    if (fileRef.current) fileRef.current.value = ""
    setFileName(null)
    setFilePreview(null)
  }

  function clearUrl() {
    setRawUrl("")
    setCleanUrl("")
    setResolveNote(null)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const formData = new FormData(e.currentTarget)

    // Always submit the cleaned/resolved URL, never the raw paste.
    formData.set("image_url", effectiveUrl)
    formData.set("crime_types", JSON.stringify(crimeTypes))

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
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="title" className={labelCls}>
            Title *
          </label>
          <input
            id="title"
            name="title"
            defaultValue={entry?.title ?? ""}
            required
            className={inputCls}
            placeholder="e.g. The Timed Skyscraper"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="type" className={labelCls}>
              Type *
            </label>
            <select
              id="type"
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
            <label htmlFor="air_date" className={labelCls}>
              Air Date *
            </label>
            <input
              id="air_date"
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
              <label htmlFor="episode_number" className={labelCls}>
                Episode #
              </label>
              <input
                id="episode_number"
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
              <label htmlFor="movie_number" className={labelCls}>
                Movie #
              </label>
              <input
                id="movie_number"
                type="number"
                name="movie_number"
                defaultValue={entry?.movie_number ?? ""}
                className={inputCls}
                placeholder="1 - 29"
              />
            </div>
          )}
          <div>
            <label htmlFor="canon_order" className={labelCls}>
              Canon Order
            </label>
            <input
              id="canon_order"
              type="number"
              name="canon_order"
              defaultValue={entry?.canon_order ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="release_order" className={labelCls}>
              Release Order
            </label>
            <input
              id="release_order"
              type="number"
              name="release_order"
              defaultValue={entry?.release_order ?? ""}
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="runtime_minutes" className={labelCls}>
              Runtime (min)
            </label>
            <input
              id="runtime_minutes"
              type="number"
              name="runtime_minutes"
              defaultValue={entry?.runtime_minutes ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="slug" className={labelCls}>
              Slug (optional)
            </label>
            <input
              id="slug"
              name="slug"
              defaultValue={entry?.slug ?? ""}
              className={inputCls}
              placeholder="auto from title"
            />
          </div>
        </div>

        <div>
          <label htmlFor="synopsis" className={labelCls}>
            Synopsis
          </label>
          <textarea
            id="synopsis"
            name="synopsis"
            defaultValue={entry?.synopsis ?? ""}
            rows={4}
            className={cn(inputCls, "h-auto py-2 resize-y")}
            placeholder="Short description..."
          />
        </div>

        <div className="rounded-md border border-white/10 p-4">
          <CrimeTypeSelector
            value={crimeTypes}
            onChange={setCrimeTypes}
            disabled={pending || isResolving}
          />
        </div>

        {/* Cover image section */}
        <div className="rounded-xl border border-ink-dim/20 bg-surface-muted p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="image_url" className={cn(labelCls, "mb-0")}>
              Cover Image Poster
            </label>
            {isResolving && (
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-amber-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Resolving Wiki file pageΓÇª
              </span>
            )}
          </div>

          <div className="flex items-start gap-4">
            <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-md border border-ink-dim/20 bg-surface flex flex-col items-center justify-center">
              {previewSrc && !imageLoadError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewSrc}
                  alt="Cover preview"
                  onError={() => setImageLoadError(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="p-2 text-center text-ink-faint">
                  <ImageIcon className="mx-auto h-6 w-6 mb-1 opacity-50" />
                  <span className="block font-mono text-[10px]">
                    {imageLoadError ? "Won't load" : "No cover"}
                  </span>
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              {/* Primary path: paste a link */}
              <div>
                <input
                  id="image_url"
                  name="image_url"
                  value={rawUrl}
                  onChange={(e) => applyUrl(e.target.value)}
                  onPaste={onUrlPaste}
                  onBlur={(e) => void resolveNow(e.target.value)}
                  className={inputCls}
                  placeholder="Paste image link address or Wiki File page linkΓÇª"
                  spellCheck={false}
                  autoComplete="off"
                />
                <p className="mt-1 text-[10px] text-ink-faint">
                  Right-click the poster on the Wiki ΓåÆ Copy image address, or paste the{" "}
                  <span className="font-mono">/wiki/File:ΓÇª</span> page link and it will be resolved
                  for you.
                </p>
              </div>

              {hasUrl && (
                <div className="space-y-2">
                  <UrlRow
                    label="Link address (as pasted)"
                    value={trimmedRaw}
                    copyLabel="Copy link address"
                    copied={copied === "raw"}
                    onCopy={() => void handleCopy("raw", trimmedRaw)}
                  />

                  <UrlRow
                    label="Clean link (saved)"
                    value={effectiveUrl}
                    hint={
                      cleanDiffers
                        ? "Thumbnail sizing and query strings stripped for full-resolution loading."
                        : "Already clean ΓÇö nothing to strip."
                    }
                    copyLabel="Copy clean link"
                    copied={copied === "clean"}
                    onCopy={() => void handleCopy("clean", effectiveUrl)}
                    emphasis
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    {needsResolve && (
                      <button
                        type="button"
                        onClick={() => void resolveNow(trimmedRaw)}
                        disabled={isResolving}
                        className={ghostBtnCls}
                      >
                        {isResolving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        Resolve Wiki page
                      </button>
                    )}

                    {cleanDiffers && (
                      <button type="button" onClick={useCleanInField} className={ghostBtnCls}>
                        <Check className="h-3 w-3" />
                        Use clean link in field
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={clearUrl}
                      className="inline-flex items-center gap-1 text-[11px] text-ink-faint transition-colors hover:text-red-400"
                    >
                      <X className="h-3.5 w-3.5" />
                      Clear link
                    </button>
                  </div>
                </div>
              )}

              {resolveNote && (
                <p className="font-mono text-[11px] text-amber-400">{resolveNote}</p>
              )}

              {imageLoadError && (
                <p className="font-mono text-[11px] text-red-400">
                  That link did not load as an image. Check it, resolve the Wiki page, or upload a
                  file instead.
                </p>
              )}

              {/* Secondary path: upload */}
              <div className="border-t border-ink-dim/15 pt-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
                    Or upload
                  </span>

                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className={ghostBtnCls}
                  >
                    <Upload className="h-3 w-3" />
                    {fileName ? "Change file" : "Upload file"}
                  </button>

                  {fileName && (
                    <>
                      <span className="max-w-[14rem] truncate font-mono text-[11px] text-green-400">
                        {fileName}
                      </span>
                      <button
                        type="button"
                        onClick={removeFile}
                        className="inline-flex items-center gap-1 text-[11px] text-ink-faint transition-colors hover:text-red-400"
                      >
                        <X className="h-3.5 w-3.5" />
                        Remove file
                      </button>
                    </>
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
                <p className="mt-1.5 text-[10px] text-ink-faint">
                  Optional. JPEG, PNG, WEBP or GIF, max 5 MB. An uploaded file replaces the pasted
                  link.
                </p>
              </div>

              <p className="sr-only" role="status" aria-live="polite">
                {copyStatus}
              </p>
              {copyStatus && (
                <p className="font-mono text-[11px] text-ink-faint">{copyStatus}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={pending || isResolving}
            className="inline-flex items-center gap-2 h-10 px-6 rounded-md bg-ink text-sm font-display text-page hover:bg-ink/80 disabled:opacity-60"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {entry ? "Save changes" : "Create entry"}
          </button>
          <Link
            href="/admin/content"
            className="h-10 inline-flex items-center px-5 rounded-md border border-ink-dim/20 text-sm font-display text-ink-dim hover:text-ink"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
