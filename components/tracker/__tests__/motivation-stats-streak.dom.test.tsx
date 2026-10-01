/**
 * The daily-streak block now lives inside the Finish Line card (tracker page)
 * instead of a standalone card, so these tests pin the wiring: signed-in users
 * see the streak inside the same card as the finish projection; signed-out
 * visitors get the sign-in hint and no streak fetch.
 *
 * The streak component's own states (alive / broken / revives) are covered by
 * streak-card.dom.test.tsx; the RPC side by the SQL migration's verify steps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MotivationStats } from "@/components/tracker/MotivationStats"
import {
  fetchStreakSnapshot,
  type StreakSnapshot,
} from "@/lib/queries/client/streaks"
import type { Database } from "@/types/database.types"

vi.mock("@/lib/queries/client/streaks", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/queries/client/streaks")>(
      "@/lib/queries/client/streaks"
    )
  return {
    ...actual,
    fetchStreakSnapshot: vi.fn(),
    reviveStreak: vi.fn(),
  }
})

const fetchMock = vi.mocked(fetchStreakSnapshot)

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

function episode(id: string): ContentEntry {
  return {
    id,
    slug: id,
    type: "episode",
    title: id,
    runtime_minutes: 25,
    episode_number: Number(id.replace(/\D/g, "")) || null,
    movie_number: null,
    air_date: "2020-01-01",
  } as ContentEntry
}

function snapshot(overrides: Partial<StreakSnapshot> = {}): StreakSnapshot {
  return {
    current: 0,
    longest: 0,
    loggedToday: false,
    lastActive: null,
    brokenStreak: null,
    brokenSince: null,
    revivesUsed: 0,
    revivesLeft: 3,
    revivesPerMonth: 3,
    ...overrides,
  }
}

function renderStats({ signedIn }: { signedIn: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const entries = [episode("ep-1"), episode("ep-2"), episode("ep-3")]
  const statuses = new Map([["ep-1", "watched" as const]])
  return render(
    <QueryClientProvider client={client}>
      <MotivationStats
        entries={entries}
        userStatuses={statuses}
        userName={signedIn ? "user-1" : null}
        userId={signedIn ? "user-1" : null}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe("MotivationStats — streak inside the Finish Line card", () => {
  it("shows the daily streak inside the same card as the finish projection", async () => {
    fetchMock.mockResolvedValue(
      snapshot({ current: 4, longest: 4, loggedToday: true, lastActive: "2026-10-01" })
    )
    renderStats({ signedIn: true })

    const finishCard = screen.getByText("Finish Line").closest("div")
    expect(finishCard).not.toBeNull()
    expect(await screen.findByText(/day streak/i)).toBeTruthy()

    // The streak renders inside the Finish Line card, not somewhere else.
    expect(finishCard?.textContent).toMatch(/day streak/i)
    expect(finishCard?.textContent).toMatch(/revives left this month/i)
  })

  it("keeps the streak out and skips the fetch for signed-out visitors", () => {
    renderStats({ signedIn: false })

    expect(screen.getByText(/no projection yet/i)).toBeTruthy()
    expect(screen.queryByText(/day streak/i)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
