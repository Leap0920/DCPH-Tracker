/*
  red-strings/fonts — the board's two chrome faces, self-hosted.

  Variant A's chrome is set in Oswald (condensed grotesque: the title, the
  legend and case-file headings, the tool labels) and Courier Prime (the
  typewriter face: stamps, counts, the search field, thread detail). Neither is
  a face the app already ships, so without these the entire chrome falls back to
  `sans-serif`/`monospace` and the board's typography — a large part of what
  makes it read as an evidence board rather than a diagram — is lost.

  The node *labels* are unaffected: they are drawn on the canvas in Inter, which
  the app already has, so `ctx.font` keeps a real family name. These two are
  CSS-only, which is why they can go through `next/font` and be referenced by
  variable — a canvas `ctx.font` cannot resolve a CSS custom property.

  Applied as variable classes on the board's root element rather than on
  `<html>`, so the two families are requested only on the route that draws them
  instead of on every page in the app.
*/

import { Courier_Prime, Oswald } from "next/font/google"

export const boardDisplay = Oswald({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-board-display",
  display: "swap",
})

export const boardMono = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-board-mono",
  display: "swap",
})

/** The classes that expose both variables. Put these on the graph root. */
export const boardFontVars = `${boardDisplay.variable} ${boardMono.variable}`
