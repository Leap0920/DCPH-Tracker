import { ContentDetail } from "@/components/tracker/ContentDetail"
import { getContentEntryBySlug } from "@/lib/queries/content"
import { notFound } from "next/navigation"

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
