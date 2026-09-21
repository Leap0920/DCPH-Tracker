import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// RTL mounts into a shared document; unmount between tests so one test's DOM
// cannot leak into the next.
afterEach(() => {
  cleanup()
})

// jsdom 30 implements none of the three APIs below (verified against the
// installed version), and the chat components call all of them. Each stub is
// deterministic so a test asserts the intended branch rather than the absence
// of the API, and each is here because a named component reads it.

// Read by framer-motion's reduced-motion detection and by
// lib/use-media-query.ts. Reporting "reduce" is the branch task 11 asserts, and
// the safe default: motion off, content unchanged.
//
// The match is a substring test, not equality, because the two callers ask two
// different questions: framer-motion asks the boolean form
// ("(prefers-reduced-motion)" — verified in
// node_modules/framer-motion/dist/es/utils/reduced-motion/index.mjs) while
// lib/use-media-query.ts asks the feature form with a value. Matching only the
// feature form left framer-motion on its animated branch, so a reduced-motion
// assertion would have tested the wrong branch while looking green.
window.matchMedia = (query: string): MediaQueryList =>
  ({
    matches: query.includes("prefers-reduced-motion") && !query.includes("no-preference"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList

// The message list scrolls the newest answer into view while streaming (task 8's
// widget); jsdom's Element has no scrollIntoView at all.
Element.prototype.scrollIntoView = () => {}

// Radix's floating primitives (the citation chip tooltip in task 5, the drawer
// in task 9) measure with a ResizeObserver, which jsdom does not provide.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverStub
