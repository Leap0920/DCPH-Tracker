/**
 * "Add to home screen" — the download control + the install sheet.
 * The control is a single download button; the sheet it opens has a single
 * action (Install) that fires the browser's deferred install prompt on the
 * spot when one is offered, waits briefly when one isn't yet (firing it the
 * moment it arrives), and never falls back to browser-menu instructions.
 * The control retires only when the app is genuinely installed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import {
  InstallAppButton,
  InstallSheetHost,
  __resetInstallStoreForTests,
} from "@/components/whats-new/InstallAppButton"
import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu"

beforeEach(() => {
  __resetInstallStoreForTests()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderAll() {
  return render(
    <>
      <InstallAppButton />
      <InstallSheetHost />
    </>
  )
}

function makePromptEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn().mockResolvedValue(undefined)
  const event = Object.assign(new Event("beforeinstallprompt"), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  })
  return { prompt, event }
}

const MENU_TEXT = /browser menu|\u22ee/i

describe("InstallAppButton + install sheet", () => {
  it("opens the sheet with exactly one download action when pressed", () => {
    renderAll()
    fireEvent.click(screen.getByRole("button", { name: /add to home screen/i }))
    expect(
      screen.getByRole("dialog", { name: /add to home screen/i })
    ).toBeTruthy()
    expect(screen.getByText("Install")).toBeTruthy()
    // One button only — no duplicate shortcut row.
    expect(screen.queryByText(/create shortcut/i)).toBeNull()
  })

  it("fires the install prompt immediately; the row stays until a real install", async () => {
    const { prompt, event } = makePromptEvent()
    renderAll()
    act(() => {
      window.dispatchEvent(event)
    })
    fireEvent.click(screen.getByRole("button", { name: /add to home screen/i }))
    await act(async () => {
      fireEvent.click(screen.getByText("Install").closest("button") as HTMLElement)
    })
    expect(prompt).toHaveBeenCalled()
    expect(screen.queryByText(MENU_TEXT)).toBeNull()
    // The sheet retires — the browser dialog took over.
    expect(screen.queryByRole("dialog")).toBeNull()
    // But the download button does NOT disappear yet: only the browser's
    // confirmed-install event retires it.
    expect(
      screen.getByRole("button", { name: /add to home screen/i })
    ).toBeTruthy()
    act(() => {
      window.dispatchEvent(new Event("appinstalled"))
    })
    expect(
      screen.queryByRole("button", { name: /add to home screen/i })
    ).toBeNull()
  })

  it("keeps the download button when the install is dismissed", async () => {
    const { prompt, event } = makePromptEvent("dismissed")
    renderAll()
    act(() => {
      window.dispatchEvent(event)
    })
    fireEvent.click(screen.getByRole("button", { name: /add to home screen/i }))
    await act(async () => {
      fireEvent.click(screen.getByText("Install").closest("button") as HTMLElement)
    })
    expect(prompt).toHaveBeenCalled()
    expect(screen.queryByText(MENU_TEXT)).toBeNull()
    // Still offered — the user can try again.
    expect(
      screen.getByRole("button", { name: /add to home screen/i })
    ).toBeTruthy()
  })

  it("waits for a prompt when none is ready, then fires it automatically", async () => {
    const { prompt, event } = makePromptEvent("dismissed")
    renderAll()
    fireEvent.click(screen.getByRole("button", { name: /add to home screen/i }))
    fireEvent.click(screen.getByText("Install").closest("button") as HTMLElement)
    expect(screen.getByRole("status").textContent).toMatch(/getting your browser ready/i)
    // The prompt arrives while we're waiting — it must fire on the spot.
    await act(async () => {
      window.dispatchEvent(event)
    })
    expect(prompt).toHaveBeenCalled()
    // Never any browser-menu directions, at any point.
    expect(screen.queryByText(MENU_TEXT)).toBeNull()
    expect(
      screen.getByRole("button", { name: /add to home screen/i })
    ).toBeTruthy()
  })

  it("shows a plain status note (never browser-menu text) when no prompt appears", async () => {
    vi.useFakeTimers()
    renderAll()
    fireEvent.click(screen.getByRole("button", { name: /add to home screen/i }))
    fireEvent.click(screen.getByText("Install").closest("button") as HTMLElement)
    expect(screen.getByRole("status").textContent).toMatch(/getting your browser ready/i)
    await act(async () => {
      vi.advanceTimersByTime(8000)
    })
    const status = screen.getByRole("status")
    expect(status.textContent).toMatch(/install dialog/i)
    expect(status.textContent).not.toMatch(MENU_TEXT)
    expect(screen.queryByText(MENU_TEXT)).toBeNull()
    expect(
      screen.getByRole("button", { name: /add to home screen/i })
    ).toBeTruthy()
  })

  it("renders as a row inside the user dropdown menu", async () => {
    render(
      <DropdownMenu modal={false} open>
        <DropdownMenuContent>
          <InstallAppButton variant="menu" />
        </DropdownMenuContent>
      </DropdownMenu>
    )
    expect(await screen.findByText(/add to home screen/i)).toBeTruthy()
  })
})
