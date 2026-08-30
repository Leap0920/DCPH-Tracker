import { describe, expect, it } from "vitest"
import { ThinkingFilter, isReasoningLine, looksLikeReasoning, stripThinking } from "@/lib/chat/answer"

describe("stripThinking", () => {
  it("removes the safety preamble that was shown as a whole answer", () => {
    // Live behaviour: "what is the incoming new movie" returned exactly this.
    expect(stripThinking("User Safety: safe")).toBe("")
    expect(stripThinking("Safety: none needed\nMovie 28 is unreleased.")).toBe(
      "Movie 28 is unreleased."
    )
  })

  it("removes closed and unterminated <think> blocks", () => {
    expect(stripThinking("<think>let me reason</think>The answer.")).toBe("The answer.")
    expect(stripThinking("<think>I never stop reasoning")).toBe("")
  })

  it("removes numbered planning lists", () => {
    const text = [
      "1. **Analyze the question**",
      "2. Check the tracker",
      "Movie 19 is Sunflowers of Inferno.",
    ].join("\n")
    expect(stripThinking(text)).toBe("Movie 19 is Sunflowers of Inferno.")
  })

  it("removes bulleted planning lists", () => {
    const text = ["- First, check the wiki", "- Need to identify the movie", "It is Movie 19."].join(
      "\n"
    )
    expect(stripThinking(text)).toBe("It is Movie 19.")
  })

  it("leaves a real answer untouched", () => {
    const answer = "Movie 19 — Sunflowers of Inferno (2015). Kaitou Kid targets the Sunflowers."
    expect(stripThinking(answer)).toBe(answer)
  })

  it("keeps everything after the answer starts", () => {
    const text = [
      "The user wants a movie.",
      "Movie 19 is **Sunflowers of Inferno**.",
      "It aired on 18 April 2015.",
    ].join("\n")
    expect(stripThinking(text)).toBe(
      "Movie 19 is **Sunflowers of Inferno**.\nIt aired on 18 April 2015."
    )
  })

  it("returns an empty string for empty input", () => {
    expect(stripThinking("")).toBe("")
  })
})

describe("isReasoningLine", () => {
  it("flags the model talking to itself", () => {
    expect(isReasoningLine("User asks: which movie?")).toBe(true)
    expect(isReasoningLine("I need to find the episode")).toBe(true)
    expect(isReasoningLine("Let me check the tracker")).toBe(true)
    expect(isReasoningLine("- **Analyze the question**")).toBe(true)
  })

  it("does not flag a real answer", () => {
    expect(isReasoningLine("Movie 19 is Sunflowers of Inferno.")).toBe(false)
    expect(isReasoningLine("Ep 129 — The Girl from the Black Organization")).toBe(false)
  })
})

describe("looksLikeReasoning", () => {
  it("detects leaks that survive stripping", () => {
    expect(looksLikeReasoning("The user is asking...")).toBe(true)
    expect(looksLikeReasoning("Here is the answer.")).toBe(false)
  })
})

describe("ThinkingFilter", () => {
  it("holds back the leading monologue and releases the answer", () => {
    const filter = new ThinkingFilter()
    // "User Safety: safe" was the entire answer to "what is the incoming new
    // movie". It must never reach the user.
    expect(filter.push("User Safety: safe\n")).toBe("")
    expect(filter.push("Movie 28 is not out yet.\n")).toBe("Movie 28 is not out yet.\n")
    expect(filter.finish()).toBe("")
  })

  it("releases as soon as the answer line is provably complete", () => {
    const filter = new ThinkingFilter()
    // No release yet: the answer line is still being written.
    expect(filter.push("I need to check the tracker.\nMovie 19 is ")).toBe("")
    // The newline proves where the answer started, so it is released whole.
    expect(filter.push("Sunflowers of Inferno.\nIt aired in 2015.\n")).toBe(
      "Movie 19 is Sunflowers of Inferno.\nIt aired in 2015.\n"
    )
    expect(filter.didRelease).toBe(true)
    expect(filter.finish()).toBe("")
  })

  it("never emits the reasoning even when the model never writes an answer", () => {
    const filter = new ThinkingFilter()
    filter.push("User asks: what movie?\n")
    filter.push("I need to find it.\n")
    expect(filter.finish()).toBe("")
    expect(filter.didRelease).toBe(false)
  })

  it("drops a <think> block split across chunk boundaries", () => {
    const filter = new ThinkingFilter()
    expect(filter.push("<think>reasoni")).toBe("")
    expect(filter.push("ng</thi")).toBe("")
    expect(filter.push("nk>\nThe answer is 19.\n")).toBe("The answer is 19.\n")
    expect(filter.finish()).toBe("")
  })

  it("drops a <think> block that opens after the answer has started", () => {
    const filter = new ThinkingFilter()
    filter.push("Movie 19 is Sunflowers of Inferno.\n")
    expect(filter.push("More <think>double check</think> text")).toBe("More  text")
  })

  it("gives up holding back once the buffer is implausibly large", () => {
    const filter = new ThinkingFilter()
    const giant = `${"word ".repeat(2_000)}\n`
    expect(filter.push(giant)).toBe(giant)
  })

  it("can be reset for a retry with another model", () => {
    const filter = new ThinkingFilter()
    expect(filter.push("I need to check the tracker.\n")).toBe("")
    filter.reset()
    expect(filter.didRelease).toBe(false)
    // A fresh attempt must not inherit the previous attempt's held text.
    expect(filter.push("Real answer.\n")).toBe("Real answer.\n")
    expect(filter.finish()).toBe("")
  })
})
