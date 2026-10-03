/**
 * The "how it works" section opens with "create your account" — which a
 * signed-in visitor has already done. Its call to action used to render
 * unconditionally, so the sign-up option was still offered to them (and, once
 * the auth dialog stopped opening for a signed-in user, that button would have
 * done nothing at all).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { HowItWorks } from "@/components/marketing/HowItWorks"

type AuthChange = (event: string, session: unknown) => void

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  authCallback: null as null | ((event: string, session: unknown) => void),
}))

vi.mock("@/utils/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: (cb: AuthChange) => {
        mocks.authCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
    },
  }),
}))

const SESSION = { user: { id: "user-1" } }

const createAccount = () =>
  screen.queryByRole("button", { name: /create account/i })

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)
  mocks.getSession.mockReset()
  mocks.authCallback = null
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("HowItWorks session awareness", () => {
  it("never offers Create account while the session is still unresolved", () => {
    mocks.getSession.mockReturnValue(new Promise(() => {}))
    render(<HowItWorks />)

    expect(createAccount()).toBeNull()
  })

  it("drops the sign-up step for a signed-in visitor", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: SESSION } })
    render(<HowItWorks />)
    await act(async () => {})

    expect(createAccount()).toBeNull()
    expect(screen.getByText(/your account is ready/i)).toBeTruthy()
    expect(screen.queryByText(/create your account/i)).toBeNull()
  })

  it("offers Create account to a signed-out visitor", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    render(<HowItWorks />)
    await act(async () => {})

    expect(createAccount()).toBeTruthy()
    expect(screen.getByText(/create your account/i)).toBeTruthy()
  })

  it("offers it again when the visitor signs out, without a reload", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: SESSION } })
    render(<HowItWorks />)
    await act(async () => {})
    expect(createAccount()).toBeNull()

    act(() => {
      mocks.authCallback?.("SIGNED_OUT", null)
    })

    expect(createAccount()).toBeTruthy()
  })
})
