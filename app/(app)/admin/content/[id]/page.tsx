import { notFound } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { ContentForm } from "@/components/admin/ContentForm"
import { updateContentEntry } from "@/lib/actions/admin-content"

export const dynamic = "force-dynamic"

export default async function EditContentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: entry } = await supabase
    .from("content_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (!entry) notFound()

  async function action(formData: FormData) {
    "use server"
    return updateContentEntry(id, formData)
  }

  return (
    <div>
      <h2 className="font-display text-sm uppercase tracking-widest text-gray-500 mb-5">
        Edit content entry
      </h2>
      <ContentForm entry={entry} action={action} />
    </div>
  )
}
