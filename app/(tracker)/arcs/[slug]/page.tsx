import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"
import { ArcTimeline } from "@/components/arcs/ArcTimeline"
import { getArcBySlug } from "@/lib/queries/arcs"

export default async function ArcDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  try {
    const arc = await getArcBySlug(slug)

    return (
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1 px-6 py-10">
          <div className="mx-auto max-w-4xl">
            <Link
              href="/arcs"
              className="inline-flex items-center gap-2 text-sm text-silver-steel hover:text-dossier-cream transition-colors mb-6"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Story Arcs
            </Link>

            <div className="mb-8 flex items-center gap-3">
              <span className="case-number">STORY ARC — CLASSIFIED</span>
              <span className="redacted-bar w-16" />
            </div>

            <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-wide text-dossier-cream mb-2">
              {arc.title}
            </h1>

            {arc.description && (
              <p className="text-dossier-cream-dim max-w-2xl mb-8">
                {arc.description}
              </p>
            )}

            <ArcTimeline entries={arc.content_entries ?? []} />
          </div>
        </main>
        <Footer />
      </div>
    )
  } catch {
    notFound()
  }
}
