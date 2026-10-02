/**
 * The daily-streak card.
 *
 * These tests drive the real component in jsdom with the streaks data layer
 * mocked (the RPC side is covered by the SQL migration's own verify steps).
 * The cases mirror the feature's rules: a live streak, a log already in for
 * today, a broken streak that can be revived (3 per calendar month), the
 * no-revives-left state, the signed-out hint, and the refresh that follows
 * a logged watch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { StreakCard } from "@/components/tracker/StreakCard"
import {
  ACTIVITY_LOGGED_EVENT,
  fetchStreakSnapshot,
  reviveStreak,
  type StreakSnapshot,
} from "@/lib/queries/client/streaks"

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
const reviveMock = vi.mocked(reviveStreak)

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

function renderCard(userId: string | null = "user-1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <StreakCard userId={userId} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe("StreakCard", () => {
  it("shows the live streak, the today-hint, and the monthly revives", async () => {
    fetchMock.mockResolvedValue(
      snapshot({
        current: 6,
        longest: 9,
        loggedToday: false,
        lastActive: "2026-09-30",
      })
    )
    renderCard()
    expect(await screen.findByText(/day streak/i)).toBeTruthy()
    expect(screen.getByText("6")).toBeTruthy()
    expect(screen.getByText(/log an episode today to keep it going/i)).toBeTruthy()
    expect(screen.getByText(/longest: 9 days/i)).toBeTruthy()
    expect(screen.getByText(/3 of 3 revives left this month/i)).toBeTruthy()
  })

  it("says when today's log is already in", async () => {
    fetchMock.mockResolvedValue(
      snapshot({
        current: 1,
        longest: 1,
        loggedToday: true,
        lastActive: "2026-10-01",
      })
    )
    renderCard()
    expect(await screen.findByText(/today's log is in/i)).toBeTruthy()
  })

  it("offers a revive for a broken streak and restores it", async () => {
    fetchMock.mockResolvedValue(
      snapshot({
        brokenStreak: 12,
        brokenSince: "2026-09-28",
        revivesUsed: 1,
        revivesLeft: 2,
      })
    )
    reviveMock.mockResolvedValue(
      snapshot({
        current: 12,
        longest: 12,
        lastActive: "2026-10-01",
        revivesUsed: 2,
        revivesLeft: 1,
      })
    )
    renderCard()
    expect(await screen.findByText(/12-day streak broke on Sep 28/i)).toBeTruthy()
    expect(screen.getByText(/2 of 3 revives left this month/i)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /revive streak/i }))
    await waitFor(() => expect(reviveMock).toHaveBeenCalledTimes(1))

    // Restored: the card flips back to the live streak view.
    expect(await screen.findByText("12")).toBeTruthy()
    expect(screen.getByText(/day streak/i)).toBeTruthy()
    expect(screen.getByText(/1 of 3 revives left this month/i)).toBeTruthy()
  })

  it("disables the revive button when the month's revives are gone", async () => {
    fetchMock.mockResolvedValue(
      snapshot({
        brokenStreak: 5,
        brokenSince: "2026-09-29",
        revivesUsed: 3,
        revivesLeft: 0,
      })
    )
    renderCard()
    expect(await screen.findByText(/5-day streak broke/i)).toBeTruthy()
    expect(screen.getByText(/no revives left this month/i)).toBeTruthy()
    const button = screen.getByRole("button", {
      name: /revive streak/i,
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it("prompts signed-out visitors to sign in instead of fetching", () => {
    renderCard(null)
    expect(
      screen.getByText(/sign in and log an episode a day to start a streak/i)
    ).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refreshes when the page logs a watch", async () => {
    fetchMock
      .mockResolvedValueOnce(
        snapshot({ current: 3, longest: 3, lastActive: "2026-09-30" })
      )
      .mockResolvedValueOnce(
        snapshot({
          current: 4,
          longest: 4,
          loggedToday: true,
          lastActive: "2026-10-01",
        })
      )
    renderCard()
    expect(await screen.findByText("3")).toBeTruthy()

    act(() => {
      window.dispatchEvent(new Event(ACTIVITY_LOGGED_EVENT))
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText("4")).toBeTruthy()
  })
})

describe("StreakCard — embedded variant", () => {
  it("renders as a bare block, no card chrome, content intact", async () => {
    fetchMock.mockResolvedValue(
      snapshot({ current: 2, longest: 2, loggedToday: true, lastActive: "2026-10-01" })
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const { container } = render(
      <QueryClientProvider client={client}>
        <StreakCard userId="user-1" variant="embedded" />
      </QueryClientProvider>
    )

    expect(await screen.findByText(/day streak/i)).toBeTruthy()
    expect(screen.getByText("2")).toBeTruthy()
    // The host card supplies the frame — the embedded block must not add its own.
    expect(container.querySelector("section")).toBeNull()
    expect(container.querySelector(".shadow-card")).toBeNull()
    // Still labelled for assistive tech.
    expect(container.querySelector('[aria-label="Daily streak"]')).not.toBeNull()
  })
})
