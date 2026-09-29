"use client"

import { useQuery } from "@tanstack/react-query"
import { ContentGrid } from "@/components/tracker/ContentGrid"
import { fetchContentEntries, type ContentEntriesResult } from "@/lib/queries/client/content"
import { queryKeys } from "@/lib/queries/keys"

export default function LayoutCheckPage() {
  const { data } = useQuery<ContentEntriesResult>({
    queryKey: queryKeys.content.all(),
    queryFn: fetchContentEntries,
    staleTime: 1000 * 60 * 60,
  })

  return (
    <div className="px-0 sm:px-6 py-6 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <div className="space-y-6">
          <div className="bg-surface border border-line rounded-lg overflow-hidden shadow-card">
            <ContentGrid entries={data?.entries ?? []} arcMap={data?.arcMap ?? null} />
          </div>
        </div>
      </div>
    </div>
  )
}
