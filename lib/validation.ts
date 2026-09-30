/**
 * Pure, dependency-free server-side input validators.
 *
 * Every function returns `null` when the input is valid, or a
 * human-readable error string otherwise. Callers return 400 + the string.
 * These run in route handlers / server actions — never trust the client.
 */

import { containsForbiddenWords } from "./profanity"

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/

export function validateUsername(username: unknown): string | null {
  if (typeof username !== "string" || username.trim().length === 0) {
    return "Username is required"
  }
  const u = username.trim()
  if (u.length < 3 || u.length > 20) {
    return "Username must be 3-20 characters"
  }
  if (!USERNAME_RE.test(u)) {
    return "Username: letters, numbers, underscores, hyphens only"
  }
  // A handle is public and permanent-ish, so vulgarity is rejected rather than
  // masked: "f***er" is still a vulgar handle, and masking it would make two
  // different inputs collide on the same stored name.
  if (containsForbiddenWords(u)) {
    return "Username contains language that isn't allowed"
  }
  return null
}

/**
 * Build the base candidate for an auto-assigned username from a display name or
 * an email address, falling back to a neutral stem when the result would be
 * empty, too short, or a slur.
 *
 * The slug rules alone are not enough: stripping punctuation out of a vulgar
 * display name ("Tar*ntada!") yields a perfectly well-formed but profane handle,
 * so the blocklist is consulted on the *result*, not on the raw input.
 *
 * Shared by both signup paths so the generated handle cannot drift between them.
 */
export function usernameBaseFrom(name: string, email: string): string {
  const candidate = (name || email.split("@")[0])
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 15)
  // The generated handle must also clear validateUsername, or a bad seed would
  // mint a handle that the signup route's own check then rejects.
  if (candidate.length < 3 || containsForbiddenWords(candidate)) {
    return "detective"
  }
  return candidate
}

export function validateDisplayName(displayName: unknown): string | null {
  if (typeof displayName !== "string" || displayName.trim().length === 0) {
    return "Display name is required"
  }
  const d = displayName.trim()
  if (d.length > 50) {
    return "Display name must be 50 characters or fewer"
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(d)) {
    return "Display name contains invalid characters"
  }
  return null
}

export function validateBio(bio: unknown): string | null {
  if (bio === null || bio === undefined) return null
  if (typeof bio !== "string") return "Bio must be text"
  if (bio.length > 280) return "Bio must be 280 characters or fewer"
  return null
}

export function validateBirthday(birthday: unknown): string | null {
  if (birthday === null || birthday === undefined || birthday === "") {
    return null // optional
  }
  if (typeof birthday !== "string") return "Birthday must be a date"
  const date = new Date(birthday)
  if (Number.isNaN(date.getTime())) return "Birthday is not a valid date"

  const now = new Date()
  if (date > now) return "Birthday cannot be in the future"

  const earliest = new Date("1900-01-01")
  if (date < earliest) return "Birthday is out of range"

  // Enforce ISO yyyy-mm-dd shape (avoids locale-parsed surprises).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
    return "Birthday must be in YYYY-MM-DD format"
  }
  return null
}

export function validateEmail(email: unknown): string | null {
  if (typeof email !== "string" || email.trim().length === 0) {
    return "Email is required"
  }
  const e = email.trim()
  // Deliberately permissive — just enough to catch malformed input.
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return "Email is not valid"
  }
  return null
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Password is required"
  }
  if (password.length < 8) {
    return "Password must be at least 8 characters"
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return "Password must contain letters and numbers"
  }
  return null
}

/**
 * Removes control characters, trims, and collapses internal whitespace.
 * Use before persisting user-supplied display text.
 */
export function sanitizeText(value: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
  return cleaned.replace(/\s+/g, " ")
}