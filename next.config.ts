import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
  // Security headers applied to every response.
  // NOTE: Content-Security-Policy is intentionally NOT set here — the
  // middleware (lib/security-headers.ts -> buildCsp) is the single source of
  // truth, because the policy is nonce-based and must be per-request.
  //
  // NOTE: Strict-Transport-Security is ALSO set by the middleware
  // (applySecurityHeaders) — conditionally, only over HTTPS. It must NOT be
  // declared here: static headers are unconditional, and HSTS from a
  // plain-HTTP host (e.g. http://<tailscale-ip>:3210) poisons browser HSTS
  // state and breaks all asset loading on that host (the "works on
  // localhost, broken via IP" bug). Middleware output overrides these
  // same-named headers, but only when it actually runs — keep both in sync.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
