/**
 * Freezes page scrolling while an overlay is open.
 *
 * The lock goes on <html>, not <body>: <html> is the viewport's scroll
 * container (see the note on `html` in globals.css), so `overflow: hidden`
 * there is what actually stops the page from scrolling. A body-level lock only
 * works while the body's overflow propagates to the viewport — the arrangement
 * globals.css deliberately moved away from, because it made every overlay
 * delete the scrollbar instead of just freezing it.
 *
 * Hiding the scrollbar normally costs 10px of layout width, which is what made
 * the page jolt sideways whenever an overlay opened — Chrome hands the width
 * back even with `scrollbar-gutter: stable`. So the lock measures what it
 * actually reclaimed and pads the body by exactly that much: the page keeps
 * its width, and the compensation is a no-op in browsers that reserve the
 * gutter themselves.
 *
 * @returns the restore function, to be called on unmount.
 */
export function lockPageScroll(): () => void {
  const html = document.documentElement
  const body = document.body
  const previousOverflow = html.style.overflow
  const previousPadding = body.style.paddingRight

  const widthBefore = html.clientWidth
  html.style.overflow = "hidden"
  const reclaimed = html.clientWidth - widthBefore

  if (reclaimed > 0) {
    const base = parseFloat(window.getComputedStyle(body).paddingRight) || 0
    body.style.paddingRight = `${base + reclaimed}px`
  }

  return () => {
    html.style.overflow = previousOverflow
    body.style.paddingRight = previousPadding
  }
}
