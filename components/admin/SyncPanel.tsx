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
      setStatus(
        result.ok ? { kind: "ok", msg: result.message ?? "Done." } : { kind: "err", msg: result.error }
      )
      setActiveMode(null)
    })
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="flex items-start gap-2 rounded-md border border-success/25 bg-success/[0.06] px-3 py-2.5 text-xs text-success">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="leading-relaxed">{status.msg}</span>
        </div>
      )}
      {status.kind === "err" && (
        <div className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger/[0.06] px-3 py-2.5 text-xs text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="leading-relaxed">{status.msg}</span>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-ink-faint">
        Requires <code className="font-mono text-[10px] text-ink-dim">CRON_SECRET</code> and{" "}
        <code className="font-mono text-[10px] text-ink-dim">SUPABASE_SERVICE_ROLE_KEY</code> to be
        configured in the environment.
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
    <div className="flex flex-col justify-between rounded-md border border-line bg-surface p-4 transition-colors hover:bg-white/[0.03]">
      <div>
        <h3 className="text-[13px] font-medium text-ink">{title}</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{desc}</p>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className="mt-4 inline-flex h-8 items-center gap-1.5 self-start rounded-md bg-accent px-3 font-mono text-[10px] uppercase tracking-wide text-white transition-colors hover:bg-accent-bright focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        {busy ? "Running…" : "Run"}
      </button>
    </div>
  )
}
