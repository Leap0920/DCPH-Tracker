import { Navbar } from "@/components/layout/Navbar"
import { Footer } from "@/components/layout/Footer"
import { ArcList } from "@/components/arcs/ArcList"
import { getArcs } from "@/lib/queries/arcs"

export default async function ArcsPage() {
  const arcs = await getArcs()

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 px-6 py-10">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center gap-3">
            <span className="case-number">FILE NO. 004 — STORY ARCS</span>
            <span className="redacted-bar w-16" />
          </div>

          <h1 className="font-display text-3xl sm:text-4xl uppercase tracking-wide text-dossier-cream mb-2">
            Story Arcs
          </h1>
          <p className="text-dossier-cream-dim mb-8 max-w-xl">
            Follow the major story threads from the first case to the latest revelations.
          </p>

          <ArcList arcs={arcs} />
        </div>
      </main>
      <Footer />
    </div>
  )
}
