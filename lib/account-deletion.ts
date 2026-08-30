/**
 * Constants for the destructive "delete account" action on the settings page.
 *
 * Extracted from the component for the same reasons as lib/tracker-reset.ts:
 * the confirmation gate is unit-testable without a DOM harness, and the phrase
 * lives in exactly one place so the dialog copy and the comparison can never
 * drift apart. The API route imports the same helper, so the server re-checks
 * the gate instead of trusting the client's button state.
 */

/** The word the user must type to enable the delete button. */
export const DELETE_CONFIRM_PHRASE = "DELETE"

/**
 * True when the typed input authorises the deletion.
 *
 * Forgiving about surrounding whitespace and letter case, matching the reset
 * gate: the point is to force a deliberate act, not to test typing accuracy.
 */
export function isDeleteConfirmed(input: string): boolean {
  return input.trim().toUpperCase() === DELETE_CONFIRM_PHRASE
}
