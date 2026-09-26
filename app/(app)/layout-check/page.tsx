"use client"

// Scratch preview route: renders the real tracker grid so the hero banner crop
// can be checked in situ without the detail drawer and mutation wiring.
// Not part of the app — delete before committing.
import { useQuery } from "@tanstack/react-query"
import { ContentGrid } from "@/components/tracker/ContentGrid"
import { fetchContentEntries } from "@/lib/queries/client/content"
import { queryKeys } from "@/lib/queries/keys"

export default function LayoutCheckPage() {
  const { data } = useQuery({
    queryKey: queryKeys.content.all(),
    queryFn: fetchContentEntries,
    staleTime: 1000 * 60 * 60,
  })

  return (
    <div className="px-0 sm:px-6 py-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <div className="space-y-6">
          <div className="bg-surface border border-line rounded-lg overflow-hidden shadow-card">
            <ContentGrid entries={data?.entries ?? []} />
          </div>
        </div>
      </div>
    </div>
  )
}
