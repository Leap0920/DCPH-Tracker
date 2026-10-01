/**
 * The "What's new" notice.
 *
 * The owner's rule: the modal appears on EVERY open of the site — no memory
 * of past views or dismissals — while never stacking with other dialogs (the
 * /characters quality chooser can open on the same visit). These tests drive
 * the real component in a real DOM (jsdom).
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { WhatsNewNotice } from "@/components/whats-new/WhatsNewNotice"

/** Is the notice on screen right now? */
function shown(): boolean {
  return screen.queryByText(/what.?s new/i) !== null
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("WhatsNewNotice", () => {
  it("appears on every open", async () => {
    render(<WhatsNewNotice />)
    expect(
      await screen.findByText(/what.?s new/i, {}, { timeout: 4000 })
    ).toBeTruthy()
    cleanup()

    render(<WhatsNewNotice />)
    expect(
      await screen.findByText(/what.?s new/i, {}, { timeout: 4000 })
    ).toBeTruthy()
  })

  it("announces the home-screen download", async () => {
    render(<WhatsNewNotice />)
    expect(
      await screen.findByText(
        /add dcph to your home screen/i,
        {},
        { timeout: 4000 }
      )
    ).toBeTruthy()
  })

  it("closes with 'Got it' and is back on the next open", async () => {
    render(<WhatsNewNotice />)
    expect(
      await screen.findByText(/what.?s new/i, {}, { timeout: 4000 })
    ).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /got it/i }))
    await waitFor(() => expect(shown()).toBe(false))

    cleanup()
    render(<WhatsNewNotice />)
    expect(
      await screen.findByText(/what.?s new/i, {}, { timeout: 4000 })
    ).toBeTruthy()
  })

  it("waits for another dialog before announcing", async () => {
    vi.useFakeTimers()
    const blocker = document.createElement("div")
    blocker.setAttribute("role", "dialog")
    document.body.appendChild(blocker)

    render(<WhatsNewNotice />)
    await act(async () => {
      vi.advanceTimersByTime(1300)
    })
    // Someone else owns the screen — stay quiet.
    expect(shown()).toBe(false)

    blocker.remove()
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    expect(shown()).toBe(true)
  })
})
