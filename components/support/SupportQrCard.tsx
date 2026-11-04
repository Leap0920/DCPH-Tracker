"use client"

import { useState } from "react"
import Image from "next/image"
import { QrCode, ScanLine } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SupportMethod } from "@/lib/support"

type QrStatus = "pending" | "ready" | "missing"

/**
 * One donation wallet, as a card.
 *
 * The QR is deliberately not hard-required: until the image exists at
 * `method.qrSrc` this renders a neutral "not ready" frame instead of a broken
 * image, and the moment the file is dropped in the same card goes live with no
 * code change. `onError` is used rather than a build-time file check so a
 * statically rendered page cannot bake in a stale state.
 *
 * The image starts hidden and only reveals itself on `onLoad`, so a missing QR
 * never flashes a white panel or a broken-image glyph first. The frame is white
 * only while the QR is really there — a QR needs a light background to scan, but
 * an empty white panel is just a hole in a dark page.
 */
export function SupportQrCard({ method }: { method: SupportMethod }) {
  const [status, setStatus] = useState<QrStatus>("pending")
  const ready = status === "ready"

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-col items-center gap-2.5 text-center">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-bright">
          <QrCode className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-base leading-tight text-ink">{method.name}</p>
          <p className="font-mono text-[10px] uppercase tracking-stamp text-ink-faint">
            {ready ? "Scan to send" : "Not open yet"}
          </p>
        </div>
      </div>

      <div className="mx-auto mt-5 w-full max-w-[248px]">
        <div
          className={cn(
            "relative aspect-square w-full overflow-hidden rounded-xl",
            ready
              ? "bg-white p-3 ring-1 ring-line"
              : "border border-dashed border-line bg-surface-muted"
          )}
        >
          {!ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center">
              <ScanLine className="h-7 w-7 text-ink-faint" />
              <p className="font-display text-sm text-ink">QR coming soon</p>
              <p className="text-[12px] leading-snug text-ink-dim">
                The payment QR is being set up. Nothing to scan yet.
              </p>
            </div>
          )}
          <Image
            src={method.qrSrc}
            alt={`${method.name} payment QR code`}
            fill
            sizes="248px"
            onLoad={() => setStatus("ready")}
            onError={() => setStatus("missing")}
            className={cn("object-contain p-1", !ready && "opacity-0")}
          />
        </div>
      </div>

      <p className="mt-4 text-center text-[13px] leading-relaxed text-ink-dim">
        {ready
          ? method.instruction
          : "Check back shortly — or see the other ways to help."}
      </p>

      {method.accountName || method.accountNumber ? (
        <dl className="mt-4 space-y-1.5 border-t border-line pt-4 font-mono text-[11px]">
          {method.accountName && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="uppercase tracking-stamp text-ink-faint">Account</dt>
              <dd className="text-ink">{method.accountName}</dd>
            </div>
          )}
          {method.accountNumber && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="uppercase tracking-stamp text-ink-faint">Number</dt>
              <dd className="text-ink">{method.accountNumber}</dd>
            </div>
          )}
        </dl>
      ) : null}
    </div>
  )
}
