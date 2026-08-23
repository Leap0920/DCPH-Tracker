/**
 * Structured logger.
 *
 * Production: one JSON object per line (parseable by Vercel / Datadog / Loki).
 * Development: compact, coloured, human-readable.
 *
 * Server-side use is the intent. It works in the browser, but avoid logging
 * anything user-identifying from client components.
 */

type LogLevel = "debug" | "info" | "warn" | "error"

export type LogContext = Record<string, unknown>

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const isProd = process.env.NODE_ENV === "production"
const isTest = process.env.NODE_ENV === "test"

/** LOG_LEVEL=debug to see everything; defaults to info in prod, debug in dev. */
const MIN_LEVEL: LogLevel = (() => {
  const raw = process.env.LOG_LEVEL?.toLowerCase()
  if (raw && raw in LEVEL_WEIGHT) return raw as LogLevel
  return isProd ? "info" : "debug"
})()

/** Keys whose values are replaced with "[redacted]" at any nesting depth. */
const REDACT_KEYS = [
  "password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "apikey",
  "api_key",
  "secret",
  "service_role",
  "cookie",
  "set-cookie",
  "session",
]

const MAX_DEPTH = 4

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (depth >= MAX_DEPTH) return "[truncated]"

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: isProd ? undefined : value.stack,
    }
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redact(item, depth + 1))
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEYS.includes(key.toLowerCase())
        ? "[redacted]"
        : redact(raw, depth + 1)
    }
    return out
  }

  if (typeof value === "bigint") return value.toString()
  if (typeof value === "function") return "[function]"

  return value
}

const DEV_PREFIX: Record<LogLevel, string> = {
  debug: "🔍",
  info: "ℹ️ ",
  warn: "⚠️ ",
  error: "❌",
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[MIN_LEVEL]) return
  if (isTest && level !== "error") return

  // Route to the matching console method so log drains classify correctly.
  const write =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "debug"
          ? console.debug
          : console.info

  const safeContext = context
    ? (redact(context) as Record<string, unknown>)
    : undefined

  if (isProd) {
    write(
      JSON.stringify({
        level,
        message,
        timestamp: new Date().toISOString(),
        env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
        ...safeContext,
      })
    )
    return
  }

  if (safeContext && Object.keys(safeContext).length > 0) {
    write(`${DEV_PREFIX[level]} [${level}] ${message}`, safeContext)
  } else {
    write(`${DEV_PREFIX[level]} [${level}] ${message}`)
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) =>
    emit("debug", message, context),
  info: (message: string, context?: LogContext) =>
    emit("info", message, context),
  warn: (message: string, context?: LogContext) =>
    emit("warn", message, context),
  error: (message: string, context?: LogContext) =>
    emit("error", message, context),

  /** Returns a logger that merges `base` into every entry. */
  child(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => emit("debug", m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => emit("info", m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => emit("warn", m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => emit("error", m, { ...base, ...c }),
    }
  },
}

export default logger
