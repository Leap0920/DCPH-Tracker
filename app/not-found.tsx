import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 text-center">
      <span className="case-number">FILE NO. 404 · CASE CLOSED</span>
      <h1 className="mt-4 font-display text-4xl tracking-tight text-ink">
        Case closed. Nothing here
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-dim">
        This page doesn&apos;t exist (or was redacted). Head back to the
        headquarters.
      </p>
      <Link href="/" className="mt-6">
        <Button className="rounded-lg">Return Home</Button>
      </Link>
    </div>
  )
}
