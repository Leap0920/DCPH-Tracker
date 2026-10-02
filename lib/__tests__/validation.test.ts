import { describe, it, expect } from "vitest"
import { validateUsername, usernameBaseFrom } from "../validation"

describe("validateUsername", () => {
  it("accepts alphanumeric, underscore and hyphen handles", () => {
    expect(validateUsername("conan_edogawa")).toBeNull()
    expect(validateUsername("heiji-hattori")).toBeNull()
    expect(validateUsername("KaitoKid1412")).toBeNull()
  })

  it("rejects special characters", () => {
    expect(validateUsername("conan!")).toBeTruthy()
    expect(validateUsername("co.nan")).toBeTruthy()
    expect(validateUsername("conan$")).toBeTruthy()
    expect(validateUsername("<script>")).toBeTruthy()
    expect(validateUsername("conan edogawa")).toBeTruthy()
  })

  it("enforces the length bounds", () => {
    expect(validateUsername("ab")).toBeTruthy()
    expect(validateUsername("a".repeat(21))).toBeTruthy()
    expect(validateUsername("")).toBeTruthy()
    expect(validateUsername(null)).toBeTruthy()
    expect(validateUsername(123)).toBeTruthy()
  })

  // The bug: profanity used to be accepted as a handle outright.
  it("rejects profanity rather than masking it", () => {
    expect(validateUsername("tarantada")).toBeTruthy()
    expect(validateUsername("gago")).toBeTruthy()
    expect(validateUsername("puta")).toBeTruthy()
  })

  // evading the blocklist with digits and filler must not get through either,
  // because foldForMatching normalises those before matching.
  it("rejects leetspeak and padded spellings", () => {
    expect(validateUsername("pu7a")).toBeTruthy()
    expect(validateUsername("p.u.t.a")).toBeTruthy()
  })

  it("does not reject ordinary handles that merely look close to a term", () => {
    expect(validateUsername("potato")).toBeNull()
    expect(validateUsername("champion")).toBeNull()
  })
})

describe("usernameBaseFrom", () => {
  it("slugs a display name", () => {
    expect(usernameBaseFrom("Shinichi Kudo", "a@b.com")).toBe("shinichikudo")
  })

  it("falls back to the email stem when there is no display name", () => {
    expect(usernameBaseFrom("", "Ran.Mouri@example.com")).toBe("ranmouri")
  })

  // The gap: punctuation-stripping a vulgar display name used to mint a
  // well-formed but profane handle.
  it("does not derive a profane handle from a vulgar display name", () => {
    expect(usernameBaseFrom("Tarantada", "a@b.com")).toBe("detective")
    expect(usernameBaseFrom("Gago", "a@b.com")).toBe("detective")
    expect(usernameBaseFrom("P.u.t.a", "a@b.com")).toBe("detective")
  })

  // Deliberate boundary of the shared blocklist: a forbidden term matches on a
  // left word boundary, so a compound that merely starts with one is not treated
  // as profane. That same rule is what keeps "potato" a valid handle, and it is
  // inherited from the chat filter's anti-false-positive design rather than
  // chosen independently by the username path.
  it("leaves compounds that only begin with a term alone", () => {
    expect(usernameBaseFrom("Potato Kid", "a@b.com")).toBe("potatokid")
  })

  it("falls back when the slug would be too short", () => {
    expect(usernameBaseFrom("!!", "a@b.com")).toBe("detective")
    expect(usernameBaseFrom("", "@b.com")).toBe("detective")
  })

  it("caps the slug at 15 characters", () => {
    expect(usernameBaseFrom("a".repeat(40), "b@c.com")).toBe("a".repeat(15))
  })
})
