import type { Metadata } from "next"
import { ContentDetail } from "@/components/tracker/ContentDetail"
import { getContentEntryBySlug } from "@/lib/queries/content"
import { notFound } from "next/navigation"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const entry = await getContentEntryBySlug(slug)

  if (!entry) return {}

  const title = entry.title
  const rawSynopsis = entry.synopsis?.trim()
  const description = (rawSynopsis && rawSynopsis.length > 0 ? rawSynopsis : "A case file from the Detective Conan PH tracker.").slice(0, 160)
  const images = [entry.image_url ?? "/hero-image.jpg"]

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images,
    },
  }
}

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const entry = await getContentEntryBySlug(slug)

  if (!entry) {
    notFound()
  }

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <ContentDetail entry={entry} />
      </div>
    </div>
  )
}
