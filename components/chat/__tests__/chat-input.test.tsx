import * as React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ChatInput } from "@/components/chat/ChatInput"

/**
 * The composer as the reader meets it. Every assertion is on what the reader can
 * see or reach — the value in the box, whether the send control is enabled, the
 * callback a keypress fires — never on the component's internal state.
 *
 * Escape is here because the hands are already on the keyboard: a reader who
 * just pressed Enter to send must be able to stop the answer without the mouse.
 */

function setup(props: Partial<React.ComponentProps<typeof ChatInput>> = {}) {
  const onSend = vi.fn()
  const onStop = vi.fn()
  render(<ChatInput onSend={onSend} onStop={onStop} {...props} />)
  return {
    onSend,
    onStop,
    box: screen.getByRole("textbox", { name: /ask about detective conan episodes/i }),
  }
}

describe("ChatInput sending", () => {
  it("sends the trimmed value on Enter and clears the box", async () => {
    const user = userEvent.setup()
    const { onSend, box } = setup()

    await user.type(box, "  who is Ai Haibara?  ")
    await user.keyboard("{Enter}")

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith("who is Ai Haibara?")
    expect(box).toHaveValue("")
  })

  it("does not send on Shift+Enter", async () => {
    const user = userEvent.setup()
    const { onSend, box } = setup()

    await user.type(box, "a first line")
    await user.keyboard("{Shift>}{Enter}{/Shift}")

    expect(onSend).not.toHaveBeenCalled()
  })

  it("does not send whitespace-only input", async () => {
    const user = userEvent.setup()
    const { onSend, box } = setup()

    await user.type(box, "   ")
    await user.keyboard("{Enter}")

    expect(onSend).not.toHaveBeenCalled()
  })

  it("disables the send control while empty and enables it once there is text", async () => {
    const user = userEvent.setup()
    const { box } = setup()

    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled()

    await user.type(box, "a question")
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled()
  })

  it("does not send when disabled", async () => {
    const user = userEvent.setup()
    const { onSend, box } = setup({ disabled: true })

    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled()

    // The box is disabled, so a keystroke cannot reach the composer at all.
    await user.type(box, "a question")
    await user.keyboard("{Enter}")

    expect(onSend).not.toHaveBeenCalled()
  })
})

describe("ChatInput stop", () => {
  it("calls onStop exactly once on Escape while streaming", async () => {
    const user = userEvent.setup()
    const { onStop, box } = setup({ isStreaming: true })

    await user.type(box, "a follow-up")
    await user.keyboard("{Escape}")

    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it("does not call onStop on Escape when not streaming", async () => {
    const user = userEvent.setup()
    const { onStop, box } = setup()

    await user.type(box, "a question")
    await user.keyboard("{Escape}")

    expect(onStop).not.toHaveBeenCalled()
  })

  it("keeps the typed text when Escape stops the answer", async () => {
    const user = userEvent.setup()
    const { box } = setup({ isStreaming: true })

    await user.type(box, "a half-written follow-up")
    await user.keyboard("{Escape}")

    expect(box).toHaveValue("a half-written follow-up")
  })

  it("renders the stop control while streaming and stops on click", async () => {
    const user = userEvent.setup()
    const { onStop } = setup({ isStreaming: true })

    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Stop generating" }))

    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
