import { describe, expect, it } from "vitest"
import {
  MASK,
  FORBIDDEN_TERMS,
  foldForMatching,
  containsForbiddenWords,
  redactForbiddenWords,
} from "@/lib/profanity"

describe("MASK", () => {
  it("is the fixed three-asterisk replacement", () => {
    expect(MASK).toBe("***")
  })
})

describe("foldForMatching", () => {
  it("preserves length so match indices map back to the original", () => {
    const samples = [
      "Tarantado ka!",
      "p0t4 ng 1na",
      "Ñoño's café — 100%",
      "시발 진짜 くそ",
      "🕵️ Detective Conan 🔍",
    ]
    for (const sample of samples) {
      expect(foldForMatching(sample)).toHaveLength(sample.length)
    }
  })

  it("folds case, accents and leetspeak but leaves the wildcards alone", () => {
    expect(foldForMatching("PUTA")).toBe("puta")
    expect(foldForMatching("cabrón")).toBe("cabron")
    expect(foldForMatching("p0t4")).toBe("pota")
    expect(foldForMatching("f*ck")).toBe("f*ck")
  })

  it("folds symbols to letters only between letters", () => {
    // Interior: leetspeak. Trailing: sentence punctuation.
    expect(foldForMatching("sh!t")).toBe("shit")
    expect(foldForMatching("g@g0")).toBe("gago")
    expect(foldForMatching("gago!")).toBe("gago!")
    expect(foldForMatching("gago!!")).toBe("gago!!")
    expect(foldForMatching("tanga!?")).toBe("tanga!?")
  })
})

describe("redactForbiddenWords — seed list", () => {
  it("masks the requested Filipino words regardless of case", () => {
    const cases: Array<[string, string]> = [
      ["Tarantado ka", `${MASK} ka`],
      ["takte naman", `${MASK} naman`],
      ["POTEK", MASK],
      ["siraulo", MASK],
      ["ulol ka", `${MASK} ka`],
      ["Puta", MASK],
      ["putragis", MASK],
      ["gago", MASK],
      ["yawa", MASK],
      ["hinayupak", MASK],
      ["lintik na", `${MASK} na`],
      ["punyeta", MASK],
      ["putangina", MASK],
      ["shet", MASK],
      ["bobo", MASK],
      ["tanga", MASK],
      ["ungas", MASK],
      ["pakyu", MASK],
      ["Kupal", MASK],
      ["buang", MASK],
      ["walang kwenta", MASK],
    ]
    for (const [input, expected] of cases) {
      expect(redactForbiddenWords(input)).toBe(expected)
    }
  })

  it("masks phrases across flexible separators", () => {
    expect(redactForbiddenWords("walang  kwenta")).toBe(MASK)
    expect(redactForbiddenWords("walang-kuwenta")).toBe(MASK)
    expect(redactForbiddenWords("putang ina mo")).toBe(`${MASK} mo`)
    expect(redactForbiddenWords("sira ulo")).toBe(MASK)
  })

  it("masks leetspeak and self-censored spellings", () => {
    expect(redactForbiddenWords("p0t4")).toBe(MASK)
    expect(redactForbiddenWords("g@g0")).toBe(MASK)
    expect(redactForbiddenWords("sh1t")).toBe(MASK)
    expect(redactForbiddenWords("sh!t")).toBe(MASK)
    expect(redactForbiddenWords("b!tch")).toBe(MASK)
    expect(redactForbiddenWords("f*ck")).toBe(MASK)
    expect(redactForbiddenWords("t*ngina")).toBe(MASK)
    expect(redactForbiddenWords("b0b0")).toBe(MASK)
  })

  it("treats trailing punctuation as punctuation, not leetspeak", () => {
    expect(redactForbiddenWords("gago!")).toBe(`${MASK}!`)
    expect(redactForbiddenWords("gago!!")).toBe(`${MASK}!!`)
    expect(redactForbiddenWords("tanga!?")).toBe(`${MASK}!?`)
    expect(redactForbiddenWords("Hello! gago")).toBe(`Hello! ${MASK}`)
  })

  it("masks stretched letters and single-filler obfuscation", () => {
    expect(redactForbiddenWords("putaaaa")).toBe(MASK)
    expect(redactForbiddenWords("shiiiit")).toBe(MASK)
    expect(redactForbiddenWords("p.u.t.a")).toBe(MASK)
    expect(redactForbiddenWords("t-a-n-g-a")).toBe(MASK)
  })

  it("masks common Filipino affixed forms", () => {
    expect(redactForbiddenWords("gagong tao")).toBe(`${MASK} tao`)
    expect(redactForbiddenWords("bobong")).toBe(MASK)
    expect(redactForbiddenWords("tangang")).toBe(MASK)
    expect(redactForbiddenWords("gagohan")).toBe(MASK)
    expect(redactForbiddenWords("kupalka")).toBe(MASK)
    expect(redactForbiddenWords("lecheng")).toBe(MASK)
  })

  it("masks the requested exact-only terms without eating real words", () => {
    expect(redactForbiddenWords("amp")).toBe(MASK)
    expect(redactForbiddenWords("animal")).toBe(MASK)
    expect(redactForbiddenWords("gaga")).toBe(MASK)
    expect(redactForbiddenWords("gagi")).toBe(MASK)
    expect(redactForbiddenWords("pota")).toBe(MASK)
  })
})

describe("redactForbiddenWords — other languages", () => {
  it("masks English and Spanish terms", () => {
    expect(redactForbiddenWords("fucking hell")).toBe(`${MASK} hell`)
    expect(redactForbiddenWords("bullshit")).toBe(MASK)
    expect(redactForbiddenWords("bitches")).toBe(MASK)
    expect(redactForbiddenWords("mierda")).toBe(MASK)
    expect(redactForbiddenWords("pendejo")).toBe(MASK)
    expect(redactForbiddenWords("cabrón")).toBe(MASK)
    expect(redactForbiddenWords("chinga tu madre")).toBe(MASK)
    expect(redactForbiddenWords("shibal")).toBe(MASK)
    expect(redactForbiddenWords("kuso")).toBe(MASK)
  })

  it("masks CJK terms with a mask clamped to the match width", () => {
    // One- and two-character terms must not grow into three asterisks.
    expect(redactForbiddenWords("좆")).toBe("*")
    expect(redactForbiddenWords("시발 진짜")).toBe("** 진짜")
    expect(redactForbiddenWords("개새끼")).toBe(MASK)
    expect(redactForbiddenWords("くそ")).toBe("**")
    expect(redactForbiddenWords("死ね")).toBe("**")
    expect(redactForbiddenWords("くそったれ")).toBe(MASK)
  })
})

describe("redactForbiddenWords — false positives", () => {
  it("leaves ordinary English words alone", () => {
    const clean = [
      "example",
      "champion",
      "camp",
      "sample",
      "amplifier",
      "animals",
      "animation",
      "class",
      "assistant",
      "passion",
      "analysis",
      "document",
      "grasshopper",
      "cocktail",
      "pussycat is a compound word",
    ]
    for (const text of clean) {
      expect(redactForbiddenWords(text)).toBe(text)
      expect(containsForbiddenWords(text)).toBe(false)
    }
  })

  it("leaves ordinary Filipino words alone", () => {
    const clean = [
      "gagawin ko mamaya",
      "gagamitin natin",
      "gagalingan",
      "boboto ako",
      "titig lang",
      "titis ng sigarilyo",
      "tangay ng baha",
      "tanghali na",
      "tanggapin natin",
      "lechon kawali",
      "ampalaya",
      "putahe",
      "kampon",
    ]
    for (const text of clean) {
      expect(redactForbiddenWords(text)).toBe(text)
    }
  })

  it("leaves Detective Conan vocabulary alone", () => {
    const clean = [
      "Shinichi Kudo",
      "Ai Haibara",
      "Kaito Kid heist",
      "Detective Boys",
      "Osaka arc with Heiji",
      "Gin and Vodka",
    ]
    for (const text of clean) {
      expect(redactForbiddenWords(text)).toBe(text)
    }
  })

  it("does not split letters across whitespace (documented limitation)", () => {
    // Allowing whitespace between letters would false-positive constantly on
    // Tagalog particles ("po ta", "ga go"), so this evasion is accepted.
    expect(redactForbiddenWords("p u t a")).toBe("p u t a")
  })

  it("masks known neutral-sense collisions (documented trade-off)", () => {
    // "leche" is on the requested list, so "leche flan" is collateral damage.
    expect(redactForbiddenWords("leche flan")).toBe(`${MASK} flan`)
  })
})

describe("redactForbiddenWords — mechanics", () => {
  it("preserves surrounding text and whitespace exactly", () => {
    expect(redactForbiddenWords("  hoy   gago   ka  ")).toBe(
      `  hoy   ${MASK}   ka  `
    )
    expect(redactForbiddenWords("gago!\ntanga?")).toBe(`${MASK}!\n${MASK}?`)
  })

  it("masks every occurrence", () => {
    expect(redactForbiddenWords("gago gago gago")).toBe(
      `${MASK} ${MASK} ${MASK}`
    )
  })

  it("prefers the longest term at a given position", () => {
    expect(redactForbiddenWords("putanginamo")).toBe(MASK)
    expect(redactForbiddenWords("motherfucker")).toBe(MASK)
  })

  it("is idempotent", () => {
    const inputs = [
      "gago ka talaga",
      "walang kwenta si tanga",
      "f*ck this sh1t",
      MASK,
      `${MASK} ${MASK}`,
      "**",
      "*",
      "clean message",
    ]
    for (const input of inputs) {
      const once = redactForbiddenWords(input)
      expect(redactForbiddenWords(once)).toBe(once)
    }
  })

  it("never lengthens the message, so the server length cap still holds", () => {
    const inputs = [
      "putangina",
      "walang kwenta",
      "gago gago gago gago",
      "f*ck",
      "시발",
    ]
    for (const input of inputs) {
      expect(redactForbiddenWords(input).length).toBeLessThanOrEqual(
        input.length
      )
    }
  })

  it("returns clean input unchanged by identity", () => {
    const text = "Anong theory niyo sa Black Organization?"
    expect(redactForbiddenWords(text)).toBe(text)
  })

  it("handles empty and whitespace-only input", () => {
    expect(redactForbiddenWords("")).toBe("")
    expect(redactForbiddenWords("   ")).toBe("   ")
    expect(containsForbiddenWords("")).toBe(false)
  })

  it("handles a 2000-character message without blowing up", () => {
    const long = `${"a".repeat(1990)} gago`
    expect(redactForbiddenWords(long)).toBe(`${"a".repeat(1990)} ${MASK}`)
  })
})

describe("containsForbiddenWords", () => {
  it("detects without mutating regex state across calls", () => {
    expect(containsForbiddenWords("gago")).toBe(true)
    expect(containsForbiddenWords("gago")).toBe(true)
    expect(containsForbiddenWords("hello")).toBe(false)
    expect(containsForbiddenWords("gago")).toBe(true)
  })
})

describe("FORBIDDEN_TERMS hygiene", () => {
  it("has no duplicate terms", () => {
    const terms = FORBIDDEN_TERMS.map((r) => r.term)
    expect(new Set(terms).size).toBe(terms.length)
  })

  it("keeps every term lowercase and trimmed", () => {
    for (const rule of FORBIDDEN_TERMS) {
      expect(rule.term).toBe(rule.term.toLowerCase())
      expect(rule.term.trim()).toBe(rule.term)
      expect(rule.term.length).toBeGreaterThan(0)
    }
  })

  it("only allows terms shorter than the mask in raw CJK scripts", () => {
    // Latin terms are all >= MASK.length, which is why they always get a
    // full-width mask; only Hangul/kana/kanji terms may be 1-2 characters.
    for (const rule of FORBIDDEN_TERMS) {
      if (rule.term.length < MASK.length) {
        expect(rule.raw).toBe(true)
      }
    }
  })

  it("does not contain terms that are ordinary words we agreed to skip", () => {
    const terms = FORBIDDEN_TERMS.map((r) => r.term)
    expect(terms).not.toContain("puto") // rice cake
    expect(terms).not.toContain("baka") // mild, ubiquitous in anime fandom
    expect(terms).not.toContain("ass") // too many innocent hits
  })
})
