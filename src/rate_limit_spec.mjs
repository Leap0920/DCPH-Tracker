/**
 * The JavaScript side of src/rate_limit_spec.bend.
 *
 * gsd-bend's sampled engine executes a top-level `src/*.js|.mjs|.cjs` namespace
 * whose name matches the law's call site, so the laws in LAWS.bend are checked
 * against these two functions on a sampled domain (GSD_BEND_SAMPLES widens it).
 * The native Bend proof is checked against src/rate_limit_spec.bend instead;
 * this file exists so the gate can also be run with GSD_BEND_ENGINE=builtin.
 *
 * It is a transcription of lib/otp-limits.ts, and
 * lib/__tests__/otp-limits.test.ts asserts the two agree on a grid of inputs —
 * including the ones that make the guard matter (0, negatives, NaN, Infinity).
 * Keep it a transcription: it is checked against the law, not against the app.
 */
export const OtpLimits = {
  usable_limit: (parsed, fallback) =>
    Number.isFinite(parsed) && parsed > 0 ? parsed : fallback,
  dev_floor: (limit, floor) => Math.max(floor, limit),
}
