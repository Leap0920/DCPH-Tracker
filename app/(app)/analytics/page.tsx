import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { getSelfAnalytics } from "@/lib/queries/analytics"
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard"

export const metadata = {
  title: "Self Analytics — Detective Conan PH",
  description: "Your personal Detective Conan watching statistics: views, rewatches, favorites, and time spent.",
}

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login?redirectTo=/analytics")
  }

  const analytics = await getSelfAnalytics(user.id)

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <AnalyticsDashboard analytics={analytics} />
      </div>
    </div>
  )
}
