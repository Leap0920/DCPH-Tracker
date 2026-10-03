/**
 * The auth dialog must not open for a visitor who already has a session —
 * whatever asked for it: the global open-auth-modal event, or a ?auth= link.
 * A signed-in user clicking "Sign Up" on the homepage used to get the signup
 * form from here, which is the second half of the reported bug.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { AuthModal } from "@/components/auth/AuthModal"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      resend: vi.fn(),
    },
  }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
  usePathname: () => "/",
}))

const SESSION = { user: { id: "user-1" } }

const dialog = () => screen.queryByRole("dialog")

// Radix Dialog measures as it opens; jsdom ships neither observer.
class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function fireOpenEvent(mode: "signin" | "signup" = "signup") {
  act(() => {
    window.dispatchEvent(new CustomEvent("open-auth-modal", { detail: { mode } }))
  })
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MockObserver)
  mocks.getSession.mockReset()
  mocks.push.mockReset()
  mocks.refresh.mockReset()
  window.history.replaceState({}, "", "/")
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("AuthModal session gate", () => {
  it("stays shut for a signed-in visitor when the open event fires", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: SESSION } })
    render(<AuthModal />)
    await act(async () => {})

    fireOpenEvent("signup")
    await act(async () => {})

    expect(dialog()).toBeNull()
  })

  it("opens for a signed-out visitor", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    render(<AuthModal />)
    await act(async () => {})

    fireOpenEvent("signup")
    await act(async () => {})

    expect(dialog()).toBeTruthy()
  })

  it("stays shut for a signed-in visitor arriving on a ?auth=signup link", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: SESSION } })
    window.history.replaceState({}, "", "/?auth=signup")

    render(<AuthModal />)
    await act(async () => {})

    expect(dialog()).toBeNull()
  })
})
