/**
 * Helpers for building PostgREST filters that contain user input.
 *
 * Two different grammars are in play and each one breaks in its own way:
 *
 *   1. LIKE/ILIKE — `%` and `_` are wildcards. escapeLike() neutralizes them.
 *   2. PostgREST's `or=` / `and=` filter grammar — `,` separates terms, `)` ends
 *      the group, and a double quote starts a quoted value. An unquoted value
 *      holding either one is a parse error (400 PGRST100) or, worse, a filter
 *      that silently matches nothing: searching "The Movie (1997)" returned zero
 *      results because everything after the `(` was swallowed as a nested group.
 *
 * Quoting fixes (2) but changes (1): inside a quoted value the backslash is an
 * escape character, so the `\%` that escapeLike() wrote is consumed and the
 * pattern silently widens back to "match anything". Every backslash therefore
 * has to be doubled when the value is quoted — verified against the live API:
 * `"%100\%%"` matched 2 rows (wrong), `"%100\\%%"` matched 0 (correct).
 */

/** Escapes LIKE/ILIKE metacharacters so `%` and `_` are matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, "\\$&")
}

/**
 * Wraps a value for PostgREST's filter grammar so `,`, `)`, `(` and quotes are
 * treated as text. Backslashes and double quotes are escaped as PostgREST expects
 * inside a quoted value.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/**
 * A ready-to-use argument for `.or(...)`: every field matched with
 * `ilike '%query%'`, with the query's wildcards neutralized and the value quoted.
 */
export function ilikeOr(query: string, fields: string[]): string {
  const value = quoteFilterValue(`%${escapeLike(query)}%`)
  return fields.map((field) => `${field}.ilike.${value}`).join(",")
}
