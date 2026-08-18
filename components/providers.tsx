"use client"

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

export function Providers({ children }: { children: React.ReactNode }) {
  // Register the static-cache service worker in production only. Dev-mode
  // registration would cache HMR responses and cause stale-module hell.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (!("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Silent: SW registration must never crash the app shell.
    })
  }, [])

  // useState initializer (NOT module-level) to avoid SSR/request state leaks
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Multi-user freshness: short enough that shared data (rankings,
            // chat) stays current, long enough to avoid refetch storms.
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      })
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
