import { notFound } from "next/navigation"
import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"
import { ContentDetail } from "@/components/tracker/ContentDetail"
import { getContentEntryBySlug } from "@/lib/queries/content"

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  try {
    const entry = await getContentEntryBySlug(slug)
    return (
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1 px-6 py-10">
          <div className="mx-auto max-w-4xl">
            <ContentDetail entry={entry} />
          </div>
        </main>
        <Footer />
      </div>
    )
  } catch {
    notFound()
  }
}
