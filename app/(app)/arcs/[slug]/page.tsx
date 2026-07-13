import { ArcTimeline } from "@/components/arcs/ArcTimeline"
import { getArcBySlug } from "@/lib/queries/arcs"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export default async function ArcDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const arc = await getArcBySlug(slug)

  if (!arc) {
    notFound()
  }

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <Link href="/arcs" className="inline-flex items-center gap-2 text-sm text-silver-steel hover:text-dossier-cream transition-colors mb-6">
          <ArrowLeft className="h-4 w-4" />
          Back to Story Arcs
        </Link>

        <div className="mb-8 flex items-center gap-3">
          <span className="case-number">FILE NO. 004 — ARC DETAIL</span>
          <span className="redacted-bar w-16" />
        </div>

        <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-wide text-dossier-cream mb-2">
          {arc.title}
        </h1>

        {arc.description && (
          <p className="text-dossier-cream-dim mb-8 max-w-xl">
            {arc.description}
          </p>
        )}

        <ArcTimeline entries={arc.content_entries ?? []} />
      </div>
    </div>
  )
}
