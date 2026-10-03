/**
 * Homepage CTA band vs. the session.
 *
 * The band used to render "Sign Up" unconditionally, so a signed-in visitor was
 * still offered the sign-up option — and the signup modal with it. These tests
 * pin the three states that matter: signed out (offer it), signed in (never),
 * and not-yet-resolved (still never, so first paint can't show it either).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { HomeCta } from "@/components/marketing/HomeCta"

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  unsubscribe: vi.fn(),
  handler: { current: null as null | ((event: string, session: unknown) => void) },
}))

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        mocks.handler.current = cb
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }
      },
    },
  }),
}))

const SESSION = { user: { id: "user-1" } }

const signUpButton = () => screen.queryByRole("button", { name: /sign up/i })

// jsdom implements neither IntersectionObserver nor matchMedia; the band's
// whileInView animations need the first one to mount at all.
class MockIntersectionObserver {
  root = null
  rootMargin = ""
  thresholds: number[] = []
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)
  mocks.handler.current = null
  mocks.getSession.mockReset()
  mocks.unsubscribe.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("HomeCta session awareness", () => {
  it("never renders Sign Up while the session is still unresolved", () => {
    mocks.getSession.mockReturnValue(new Promise(() => {}))
    render(<HomeCta />)
    expect(signUpButton()).toBeNull()
  })

  it("hides Sign Up and the join copy from a signed-in visitor", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: SESSION } })
    render(<HomeCta />)
    await act(async () => {})

    expect(signUpButton()).toBeNull()
    expect(screen.getByText(/continue tracking/i)).toBeTruthy()
    expect(screen.queryByText(/free to join/i)).toBeNull()
  })

  it("offers Sign Up to a signed-out visitor", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    render(<HomeCta />)
    await act(async () => {})

    expect(signUpButton()).toBeTruthy()
    expect(screen.getByText(/start tracking/i)).toBeTruthy()
  })

  it("offers Sign Up again when the visitor signs out, without a reload", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: SESSION } })
    render(<HomeCta />)
    await act(async () => {})
    expect(signUpButton()).toBeNull()

    act(() => {
      mocks.handler.current?.("SIGNED_OUT", null)
    })

    expect(signUpButton()).toBeTruthy()
  })
})
