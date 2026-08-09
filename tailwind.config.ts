import type { Config } from "tailwindcss";

// ─────────────────────────────────────────────────────────
// DESIGN TOKENS — "Modern Clean Light" theme
// Direction: soft light surfaces, crisp dark ink text, one
// strong rose-red accent, clean sans typography. Consistent
// across every page — no dark/mixed surfaces.
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
        page: "#F8FAFC",          // app background (slate-50)
        surface: "#FFFFFF",       // cards / panels
        "surface-muted": "#F1F5F9", // secondary surfaces, hover (slate-100)
        ink: "#0F172A",           // primary text (slate-900)
        "ink-dim": "#475569",     // secondary text (slate-600)
        "ink-faint": "#94A3B8",   // muted / placeholder (slate-400)
        accent: "#E11D48",        // primary accent (rose-600)
        "accent-bright": "#F43F5E", // hover / active (rose-500)
        "accent-soft": "#FFF1F2", // tinted backgrounds (rose-50)
        "gold-seal": "#F59E0B",   // rare accent — rank badges, seals only (amber-500)
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
        card: "0 1px 3px 0 rgb(15 23 42 / 0.08), 0 1px 2px -1px rgb(15 23 42 / 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
