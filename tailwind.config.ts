import type { Config } from "tailwindcss";

// ─────────────────────────────────────────────────────────
// DESIGN TOKENS — "Modern Clean" theme
// Direction: soft surfaces, crisp ink text, one strong rose-red
// accent, clean sans typography. Tokens resolve to CSS variables
// (defined in app/globals.css) so the `dark` class on <html>
// swaps the whole palette at once (class-based dark mode).
//
// The keyframes/animation/boxShadow blocks below are ADDITIVE motion
// primitives for the graph + marketing polish. No token, color or font
// values were changed.
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
        // Additive: accent-tinted lift for interactive surfaces.
        glow: "0 0 0 1px rgb(var(--accent) / 0.18), 0 8px 24px -8px rgb(var(--accent) / 0.35)",
        "glow-lg": "0 0 0 1px rgb(var(--accent) / 0.22), 0 20px 48px -12px rgb(var(--accent) / 0.45)",
        lift: "0 12px 32px -12px rgb(var(--ink) / 0.22), 0 2px 6px -2px rgb(var(--ink) / 0.1)",
      },
      keyframes: {
        "dcph-float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        "dcph-pulse-ring": {
          "0%": { transform: "scale(1)", opacity: "0.55" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        "dcph-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "dcph-rise": {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "dcph-tick": {
          "0%, 100%": { transform: "translateX(0)" },
          "50%": { transform: "translateX(3px)" },
        },
      },
      animation: {
        "dcph-float": "dcph-float 6s ease-in-out infinite",
        "dcph-pulse-ring": "dcph-pulse-ring 2.6s cubic-bezier(0.16,1,0.3,1) infinite",
        "dcph-shimmer": "dcph-shimmer 2.4s linear infinite",
        "dcph-rise": "dcph-rise 0.6s cubic-bezier(0.16,1,0.3,1) both",
        "dcph-tick": "dcph-tick 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;