import type { MetadataRoute } from "next";

// PWA manifest served at /manifest.webmanifest (Next auto-links it from the
// root layout). Conservative installability: no push, no offline-first.
//
// Icon strategy: Chromium's installability check requires a >=192/512px
// RASTER icon, and this repo has no raster-image tooling, so we ship the
// hand-authored SVG mark as the primary icon PLUS a raster fallback entry
// that reuses the existing public/hero-image.jpg to satisfy the check.
// A proper branded 512px PNG icon is documented future work.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Detective Conan PH",
    short_name: "DCPH Tracker",
    description:
      "The Filipino Detective Conan community: track episodes, join discussions, and prove your rank in the organization.",
    start_url: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#E11D48",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        // Raster fallback so Chromium's installability check (requires a
        // >=192/512px raster) has a raster entry. Replace with a real
        // branded 512px PNG when image tooling exists.
        src: "/hero-image.jpg",
        sizes: "512x512",
        type: "image/jpeg",
        purpose: "any",
      },
    ],
  };
}
