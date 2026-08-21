/**
 * Constants for the destructive "reset tracker record" action on the settings
 * page. Extracted from the component so the confirmation gate is unit-testable
 * without a DOM harness, and so the phrase appears in exactly one place — the
 * dialog copy and the comparison can never drift apart.
 */

/** The word the user must type to enable the reset button. */
export const RESET_CONFIRM_PHRASE = "RESET"

/**
 * True when the typed input authorises the reset.
 *
 * Deliberately forgiving about surrounding whitespace and letter case: the point
 * of the gate is to force a deliberate act, not to test typing accuracy. A
 * trailing space from a paste should not block someone who meant it.
 */
export function isResetConfirmed(input: string): boolean {
  return input.trim().toUpperCase() === RESET_CONFIRM_PHRASE
}
