import { ContentForm } from "@/components/admin/ContentForm"
import { createContentEntry } from "@/lib/actions/admin-content"

export const dynamic = "force-dynamic"

export default function NewContentPage() {
  async function action(formData: FormData) {
    "use server"
    return createContentEntry(formData)
  }

  return (
    <div>
      <h2 className="font-display text-sm tracking-tight text-ink-dim mb-5">
        New content entry
      </h2>
      <ContentForm action={action} />
    </div>
  )
}
