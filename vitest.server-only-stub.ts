// No-op stand-in for Next.js's build-time "server-only" alias.
// Next resolves this package at bundle time; vitest (plain node) cannot, so
// tests alias it here. Modules that import "server-only" still execute their
// guards in real builds — this stub is test-environment only.
export {}
