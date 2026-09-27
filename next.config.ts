import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
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
