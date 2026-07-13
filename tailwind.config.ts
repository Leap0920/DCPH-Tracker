import type { Config } from "tailwindcss";

// ─────────────────────────────────────────────────────────
// DESIGN TOKENS — "Black Organization" theme
// Direction: a case-file / member-dossier aesthetic rather than
// a generic dark-mode-with-neon-accent look. Muted blood red +
// gunmetal silver on near-black, typewriter/dossier type for data.
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
        "noir-black": "#0B0B0D",      // base background
        "case-file": "#17181C",       // card / panel surface
        "case-file-raised": "#1F2025", // elevated surface (hover, modals)
        "poison-red": "#7A1620",      // primary accent — muted, not neon
        "poison-red-bright": "#A5202D", // hover/active state only
        "silver-steel": "#A8ACB3",    // secondary accent, metallic text
        "dossier-cream": "#E9E4D8",   // primary text — aged paper, not stark white
        "dossier-cream-dim": "#B8B3A6", // secondary/muted text
        "gold-seal": "#9C7A2E",       // rare accent — rank badges, seals only
        "redacted": "#0F0F11",        // bar/divider blackout color
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],   // poster/case-header type
        body: ["var(--font-body)", "sans-serif"],          // reading text
        mono: ["var(--font-mono)", "monospace"],           // case numbers, stats, timestamps
      },
      letterSpacing: {
        stamp: "0.18em",
      },
      backgroundImage: {
        "grain": "url('/textures/grain.png')",
      },
      boxShadow: {
        dossier: "0 1px 0 0 rgba(168,172,179,0.08), 0 8px 24px -8px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
