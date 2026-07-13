import { ArcList } from "@/components/arcs/ArcList"
import { getArcs } from "@/lib/queries/arcs"

export default async function ArcsPage() {
  const arcs = await getArcs()

  return (
    <div className="px-6 py-10">
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
    </div>
  )
}
