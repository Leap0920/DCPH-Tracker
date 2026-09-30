import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    /*
      Quota guardrails for the Vercel image optimizer (Hobby = 5,000
      transformations/month, billed per unique src+width+format — and the
      default 60-second cache TTL re-billed every sweep).

      * webp only — "avif"+"webp" doubled every variant for marginal gain.
      * minimumCacheTTL 31 days — repeat views stop re-transforming.
      * sizes trimmed — each image gets a handful of widths instead of the
        default 16-combination spread.

      remotePatterns used to be "**", which let ANY remote URL be fetched
      and optimized through this deployment (a quota-drain / open-relay
      vector). The list below is exactly what content_entries.image_url and
      profile avatars actually reference today, plus the OAuth avatar hosts.

      EMERGENCY SWITCH: set IMAGE_OPTIMIZATION_DISABLED=true in the Vercel
      project env and redeploy to bypass the optimizer entirely if the
      transformation quota is exhausted (images then load straight from
      their source; every host you need must also be allowed by the CSP
      img-src in lib/security-headers.ts).
    */
    formats: ["image/webp"],
    minimumCacheTTL: 2678400, // 31 days
    deviceSizes: [640, 828, 1080, 1920],
    imageSizes: [64, 128, 256, 384],
    unoptimized: process.env.IMAGE_OPTIMIZATION_DISABLED === "true",
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "detectiveconanworld.com" },
      { protocol: "https", hostname: "www.detectiveconanworld.com" },
      { protocol: "https", hostname: "**.detectiveconanworld.com" },
      { protocol: "https", hostname: "static.wikia.nocookie.net" },
      { protocol: "https", hostname: "**.fandom.com" },
      { protocol: "https", hostname: "media.kitsu.app" },
      { protocol: "https", hostname: "cdn.myanimelist.net" },
      { protocol: "https", hostname: "s4.anilist.co" },
      { protocol: "https", hostname: "m.media-amazon.com" },
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  /*
    Security headers.

    Split by reach, not by topic:

    * Content-Security-Policy, X-Frame-Options, Referrer-Policy,
      Permissions-Policy, Cross-Origin-Opener-Policy and (production-only)
      Strict-Transport-Security are set by the middleware
      (lib/security-headers.ts) — the CSP is nonce-based and per-request, so it
      cannot live here. Setting any of them in BOTH places is a trap: the
      config's copy is applied after the middleware's and wins, which is how
      HSTS ended up emitted in development and how the weaker
      Permissions-Policy in this file silently replaced the middleware's.

    * The three below are here because they must also cover static assets, which
      the middleware matcher deliberately skips.

    CORP closes hotlinking of the video/image assets and stops another origin
    from reading our API responses; nosniff stops MIME-sniffing of the JS/CSS
    chunks served straight from /_next/static.
  */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
