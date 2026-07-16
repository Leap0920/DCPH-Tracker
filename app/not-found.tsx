import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center">
      <span className="case-number">FILE NO. 404 — CASE CLOSED</span>
      <h1 className="mt-4 font-display text-4xl uppercase tracking-wide text-gray-900">
        Page not found
      </h1>
      <p className="mt-2 max-w-md text-sm text-gray-500">
        This case file doesn&apos;t exist. The trail went cold — let&apos;s get you
        back to headquarters.
      </p>
      <Link href="/" className="mt-6">
        <Button className="rounded-lg">Return Home</Button>
      </Link>
    </div>
  )
}
