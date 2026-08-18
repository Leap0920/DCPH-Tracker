import type { Config } from "tailwindcss";

// ─────────────────────────────────────────────────────────
// DESIGN TOKENS — "Modern Clean" theme
// Direction: soft surfaces, crisp ink text, one strong rose-red
// accent, clean sans typography. Tokens resolve to CSS variables
// (defined in app/globals.css) so the `dark` class on <html>
// swaps the whole palette at once (class-based dark mode).
// ─────────────────────────────────────────────────────────

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        page: "rgb(var(--page) / <alpha-value>)",           // app background
        surface: "rgb(var(--surface) / <alpha-value>)",     // cards / panels
        "surface-muted": "rgb(var(--surface-muted) / <alpha-value>)", // secondary surfaces, hover
        ink: "rgb(var(--ink) / <alpha-value>)",             // primary text
        "ink-dim": "rgb(var(--ink-dim) / <alpha-value>)",   // secondary text
        "ink-faint": "rgb(var(--ink-faint) / <alpha-value>)", // muted / placeholder
        accent: "rgb(var(--accent) / <alpha-value>)",       // primary accent (rose)
        "accent-bright": "rgb(var(--accent-bright) / <alpha-value>)", // hover / active
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)", // tinted backgrounds
        "gold-seal": "rgb(var(--gold-seal) / <alpha-value>)", // rare accent — rank badges, seals only
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],   // headings
        body: ["var(--font-body)", "sans-serif"],          // reading text
        mono: ["var(--font-mono)", "monospace"],           // numbers, stats, timestamps
      },
      letterSpacing: {
        stamp: "0.18em",
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(var(--ink) / 0.08), 0 1px 2px -1px rgb(var(--ink) / 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
