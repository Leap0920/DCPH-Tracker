"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

export function Providers({ children }: { children: React.ReactNode }) {
  // Service worker registration lives in ServiceWorkerRegister (mounted in the
  // root layout): a single registrar using the version-bumped script URL that
  // reliable updates require. Don't register a second time here.

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
