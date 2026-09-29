/**
 * Regression guard for the carousel's sound button.
 *
 * The mute/play/fullscreen controls live inside the same element that owns the
 * "tap the picture to play/pause" click handler. Before the fix, pressing
 * Sound also bubbled to that handler, so unmute paused the video — and on
 * touch the same gesture could register as a swipe and change slide.
 *
 * These tests drive the real component in a real DOM: click the actual Sound
 * button and assert playback state and slide index are untouched.
 *
 * jsdom implements no media pipeline, so play/pause are stubbed and autoplay is
 * started by dispatching `loadeddata` (the component's own hook for that).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react"
import ElegantCarousel from "@/components/ui/elegant-carousel"

/** Mounts the carousel and gets autoplay going, as a browser would. */
async function mountCarousel() {
  const view = render(<ElegantCarousel />)
  const video = view.container.querySelector(
    "video"
  ) as HTMLVideoElement
  // The component waits for `loadeddata` before calling play(); jsdom never
  // fires it on its own, so fire it here to reach the playing state.
  await act(async () => {
    video.dispatchEvent(new Event("loadeddata"))
    await Promise.resolve()
    await Promise.resolve()
  })
  return { view, video }
}

/**
 * The tappable picture itself. It shares its aria-label with the play/pause
 * button in the overlay, so it is found by tag, not by accessible name.
 */
function surface(): HTMLElement {
  return screen
    .getAllByRole("button", { name: /pause video|play video/i })
    .find((el) => el.tagName === "DIV") as HTMLElement
}

/** A real <button> in the overlay, by its accessible name. */
function control(name: RegExp): HTMLElement {
  return screen
    .getAllByRole("button", { name })
    .find((el) => el.tagName === "BUTTON") as HTMLElement
}

describe("ElegantCarousel sound button", () => {
  let playSpy: ReturnType<typeof vi.fn>
  let pauseSpy: ReturnType<typeof vi.fn>
  // jsdom has no media pipeline, so `paused` is permanently true and never
  // flips. togglePlay() branches on it, so back it with a real flag the stubs
  // drive — otherwise every tap would look like "start playing" and the pause
  // path would be unreachable.
  let playing: boolean

  beforeEach(() => {
    playing = false
    playSpy = vi.fn().mockImplementation(() => {
      playing = true
      return Promise.resolve()
    })
    pauseSpy = vi.fn().mockImplementation(() => {
      playing = false
    })
    Object.defineProperty(HTMLMediaElement.prototype, "paused", {
      configurable: true,
      get() {
        return !playing
      },
    })
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: playSpy,
    })
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      writable: true,
      value: pauseSpy,
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)
      .paused
  })

  it("unmutes without pausing playback or changing slide", async () => {
    const { video } = await mountCarousel()

    // Sanity: the component is in its playing state, on slide 1.
    expect(playSpy).toHaveBeenCalled()
    expect(control(/pause video/i)).toBeTruthy()
    const titleBefore = screen.getByRole("heading", { level: 2 }).textContent

    pauseSpy.mockClear()

    await act(async () => {
      fireEvent.click(control(/unmute sound/i))
    })

    // The bug: pressing Sound paused the video.
    expect(pauseSpy).not.toHaveBeenCalled()
    // Still on the same slide.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      titleBefore
    )
    expect(video.muted).toBe(false)
    // Button now reads "mute", proving the toggle actually flipped.
    expect(control(/mute sound/i)).toBeTruthy()
  })

  it("tapping the picture still toggles playback", async () => {
    const { video } = await mountCarousel()

    await act(async () => {
      fireEvent.click(surface())
    })

    // The suppression window must not swallow a genuine tap.
    expect(pauseSpy).toHaveBeenCalled()
    expect(video.muted).toBe(true)
  })

  it("a swipe that ends on the sound button does not toggle playback", async () => {
    await mountCarousel()

    pauseSpy.mockClear()
    const soundButton = control(/unmute sound/i)
    const target = soundButton.closest(
      '[role="button"][aria-label*="ideo"]'
    ) as HTMLElement

    // A real drag: touchstart, travel past the 60px threshold, touchend — then
    // the browser delivers the trailing synthetic click.
    await act(async () => {
      fireEvent.touchStart(target, { targetTouches: [{ clientX: 300 }] })
      fireEvent.touchMove(target, { targetTouches: [{ clientX: 120 }] })
      fireEvent.touchEnd(target)
      fireEvent.click(target)
    })

    expect(pauseSpy).not.toHaveBeenCalled()
  })

  it("pressing fullscreen does not toggle playback", async () => {
    await mountCarousel()

    pauseSpy.mockClear()
    await act(async () => {
      fireEvent.click(control(/play fullscreen/i))
    })

    expect(pauseSpy).not.toHaveBeenCalled()
  })

  it("the seek slider does not toggle playback", async () => {
    await mountCarousel()

    pauseSpy.mockClear()
    const slider = screen.getByRole("slider", {
      name: /seek video progress/i
    }) as HTMLInputElement
    await act(async () => {
      // duration is NaN in jsdom, so seeking is a no-op — the point is that
      // the interaction never reaches the surface's click handler.
      fireEvent.change(slider, { target: { value: "40" } })
      fireEvent.click(slider)
    })

    expect(pauseSpy).not.toHaveBeenCalled()
  })
})
