import { describe, expect, it } from "vitest"
import {
  extractLeadText,
  extractListItems,
  extractSectionText,
  parseHtml,
} from "@/lib/chat/search"

/**
 * The wiki context the model reads used to be the whole document with the tags
 * stripped, so it opened with infobox labels and spoiler banners. These pin the
 * paragraph-first behaviour and the version-tolerant `parse.text` read.
 */

const INFOBOX_FIRST_HTML = `<div class="mw-content-ltr mw-parser-output"><div class="infobox"><span>Ai Haibara</span><div>Japanese name: 灰原 哀</div><div>Age: 18</div></div>
<p><b>Ai Haibara</b> (灰原 哀, Haibara Ai?), real name <b>Shiho Miyano</b>&#32;(宮野 志保), is the creator of APTX 4869&#91;1&#93;.</p>
<p>She is a former member of the [[Black Organization|Organization]].</p></div>`

describe("parseHtml", () => {
  it("reads the formatversion 1 shape", () => {
    expect(parseHtml({ title: "T", pageid: 1, text: { "*": "<p>hello</p>" } })).toBe("<p>hello</p>")
  })

  it("reads the formatversion 2 shape", () => {
    expect(parseHtml({ title: "T", pageid: 1, text: "<p>hello</p>" })).toBe("<p>hello</p>")
  })

  it("returns an empty string when the page has no text", () => {
    expect(parseHtml({ title: "T", pageid: 1 })).toBe("")
    expect(parseHtml(undefined)).toBe("")
  })
})

describe("extractLeadText", () => {
  it("starts at the article prose, not the infobox", () => {
    const text = extractLeadText(INFOBOX_FIRST_HTML, 600)
    expect(text.startsWith("Ai Haibara (灰原 哀")).toBe(true)
    expect(text).not.toContain("Japanese name:")
    expect(text).not.toContain("Age: 18")
  })

  it("decodes the numeric entities the wiki leaves behind", () => {
    const text = extractLeadText(INFOBOX_FIRST_HTML, 600)
    expect(text).toContain("APTX 4869[1]")
    expect(text).not.toContain("&#")
  })

  it("strips wikitext link markup", () => {
    const text = extractLeadText(INFOBOX_FIRST_HTML, 600)
    expect(text).toContain("member of the Organization")
    expect(text).not.toContain("[[")
  })

  it("joins paragraphs and caps the result", () => {
    const text = extractLeadText(INFOBOX_FIRST_HTML, 600)
    expect(text).toContain("She is a former member of the Organization")

    const capped = extractLeadText(INFOBOX_FIRST_HTML, 80)
    expect(capped.length).toBe(80)
    expect(capped).toBe(text.slice(0, 80))
  })

  it("falls back to a whole-document strip when there are no paragraphs", () => {
    const html = `<div class="infobox"><div>Japanese name: 灰原 哀 (Haibara Ai)</div></div>`
    expect(extractLeadText(html, 600)).toBe("Japanese name: 灰原 哀 (Haibara Ai)")
  })

  it("returns nothing for empty input", () => {
    expect(extractLeadText("", 600)).toBe("")
  })

  it("falls back to list items on a page that has no paragraphs", () => {
    const html = `<ul><li>Episode 176 : Reunion with the Black Organization (Haibara)</li><li>Episode 177 : Reunion with the Black Organization (Conan)</li></ul>`
    const text = extractLeadText(html, 600)
    expect(text).toContain("Episode 176 : Reunion with the Black Organization (Haibara)")
    expect(text).toContain("Episode 177")
  })
})

/**
 * A "Resolution" section is a whole-section read (it is fetched with
 * `section=N`), and DCW hides the culprit reveal in a JS-toggled spoiler div
 * whose text sits outside any `<p>`.
 */
describe("extractSectionText", () => {
  const RESOLUTION_HTML = `<div class="mw-parser-output"><div class="mw-editsection"><span class="mw-editsection-bracket">[</span><a href="/wiki/x?action=edit">edit</a><span class="mw-editsection-bracket">]</span></div>
<p>Sakuraba is soon arrested. However, the murder weapon is still missing.</p><hr />
<div id="spoilerbordertoggledisplay1" style="border: 1px dotted #cccccc;"><img src="/wiki/images/9/9d/Spoiler.png" alt="Spoiler icon" /><a id="toggledisplay1l" href="javascript:toggleDisplay( &quot;toggledisplay1&quot; )">Show spoilers &#187;</a>
<p>The real culprit is revealed to be <b>Kikuhito Morizono</b>. Heiji and Conan fake him out by stating Sakuraba is the criminal.</p></div></div>`

  it("keeps the spoiler reveal that the lead extract never reaches", () => {
    const text = extractSectionText(RESOLUTION_HTML, 700)
    expect(text).toContain("The real culprit is revealed to be Kikuhito Morizono")
    expect(text).toContain("the murder weapon is still missing")
  })

  it("drops edit links and the spoiler toggle label", () => {
    const text = extractSectionText(RESOLUTION_HTML, 700)
    expect(text).not.toContain("[edit]")
    expect(text).not.toContain("Show spoilers")
  })

  it("caps the section text", () => {
    const capped = extractSectionText(RESOLUTION_HTML, 60)
    expect(capped.length).toBe(60)
  })
})

describe("extractListItems", () => {
  const LIST_HTML = `<ul><li><a href="/wiki/Episode_176">Episode 176</a> : Reunion with the Black Organization (Haibara)</li>
<li>Episode 190 : The Desperate Revival (The Third Choice) ( Note: Black figure background)</li>
<li>Episode 230 : The Mysterious Passenger (Part 1)</li></ul>`

  it("joins list items into one line, in page order", () => {
    const text = extractListItems(LIST_HTML, 900)
    expect(text.split(" · ")[0]).toBe("Episode 176 : Reunion with the Black Organization (Haibara)")
    expect(text).toContain("Episode 190 : The Desperate Revival (The Third Choice)")
    expect(text).toContain("Episode 230 : The Mysterious Passenger (Part 1)")
  })

  it("stops before the budget instead of cutting an entry in half", () => {
    const text = extractListItems(LIST_HTML, 100)
    expect(text).not.toContain("Episode 230")
    expect(text.endsWith(")")).toBe(true)
  })

  it("returns nothing when the section has no items", () => {
    expect(extractListItems("<p>no list here</p>", 900)).toBe("")
  })
})
