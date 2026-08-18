"use client"

import { useState, useTransition } from "react"
import { RefreshCw, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { triggerSync } from "@/lib/actions/admin-system"

type Status = { kind: "idle" } | { kind: "ok"; msg: string } | { kind: "err"; msg: string }

export function SyncPanel() {
  const [pending, startTransition] = useTransition()
  const [activeMode, setActiveMode] = useState<"seed" | "airing" | null>(null)
  const [status, setStatus] = useState<Status>({ kind: "idle" })

  function run(mode: "seed" | "airing") {
    setActiveMode(mode)
    setStatus({ kind: "idle" })
    startTransition(async () => {
      const result = await triggerSync(mode)
      setStatus(result.ok ? { kind: "ok", msg: result.message ?? "Done." } : { kind: "err", msg: result.error })
      setActiveMode(null)
    })
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <SyncCard
          title="Airing sync"
          desc="Checks AniList for the next airing episode and pulls any new episodes from Jikan. Fast, safe to run often."
          busy={pending && activeMode === "airing"}
          disabled={pending}
          onClick={() => run("airing")}
        />
        <SyncCard
          title="Full seed"
          desc="Re-pulls the complete episode list (Jikan) and franchise movies/specials/OVAs (Kitsu). Slower; upserts everything."
          busy={pending && activeMode === "seed"}
          disabled={pending}
          onClick={() => run("seed")}
        />
      </div>

      {status.kind === "ok" && (
        <div className="flex items-start gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{status.msg}</span>
        </div>
      )}
      {status.kind === "err" && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{status.msg}</span>
        </div>
      )}

      <p className="text-xs text-ink-faint">
        Requires <code className="font-mono">CRON_SECRET</code> and{" "}
        <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> to be configured in the environment.
      </p>
    </div>
  )
}

function SyncCard({
  title,
  desc,
  busy,
  disabled,
  onClick,
}: {
  title: string
  desc: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <div className="rounded-lg border border-ink-dim/20 bg-surface p-5 shadow-card">
      <h3 className="font-display  text-ink">{title}</h3>
      <p className="mt-1 text-sm text-ink-dim">{desc}</p>
      <button
        onClick={onClick}
        disabled={disabled}
        className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-accent text-sm font-display text-white hover:bg-accent-bright disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {busy ? "Running…" : "Run"}
      </button>
    </div>
  )
}
