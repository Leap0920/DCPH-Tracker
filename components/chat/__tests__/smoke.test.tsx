import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

/**
 * The smallest thing that proves the jsdom project is wired up: JSX compiles,
 * the document exists, the jest-dom matchers from vitest.setup.dom.ts are
 * registered, and cleanup runs between tests. Real component tests live beside
 * the components they exercise (plan 5, tasks 4-11).
 */
function Smoke() {
  return <p>jsdom project is running</p>
}

describe("jsdom project", () => {
  it("renders a component and matches with jest-dom", () => {
    render(<Smoke />)

    expect(screen.getByText("jsdom project is running")).toBeInTheDocument()
  })
})
