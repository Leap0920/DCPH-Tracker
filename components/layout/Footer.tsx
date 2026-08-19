import Link from "next/link"
import { Facebook, Instagram, Youtube, Twitter } from "lucide-react"

const footerLinks = [
  { label: "Tracker", href: "/tracker" },
  { label: "Story Arcs", href: "/arcs" },
  { label: "Characters", href: "/characters" },
  { label: "Rankings", href: "/community/rankings" },
  { label: "Chat", href: "/community/chat" },
]

const socialLinks = [
  { icon: Facebook, href: "https://www.facebook.com/conanph0304", label: "Facebook" },
  { icon: Instagram, href: "https://www.instagram.com/conanph0304/", label: "Instagram" },
  { icon: Youtube, href: "https://www.youtube.com/@conanph0304", label: "YouTube" },
  { icon: Twitter, href: "https://x.com/conanph0304", label: "X" },
]

/** Stays a server component — all polish here is CSS-only, no client JS. */
export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-ink-dim/20 bg-surface">
      {/* Accent hairline along the very top edge. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent"
      />
      {/* Very faint drifting wash so the footer isn't a dead slab. */}
      <span
        aria-hidden
        className="dcph-drift-slower pointer-events-none absolute -bottom-24 left-[12%] h-64 w-64 rounded-full bg-accent/[0.04] blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {/* Brand */}
          <div>
            <Link href="/" className="group mb-4 flex items-center gap-2">
              <img
                src="/img/logo_DCPH.png"
                alt="Detective Conan PH Logo"
                className="h-8 w-auto object-contain transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3"
              />
              <span className="font-display text-lg text-ink">
                Detective Conan <span className="text-accent">PH</span>
              </span>
            </Link>
            <p className="max-w-xs text-sm text-ink-dim">
              The Filipino Detective Conan community: track episodes, join discussions,
              and prove your rank in the organization.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="mb-4 font-display text-sm text-ink">
              Navigation
            </h3>
            <ul className="space-y-2">
              {footerLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="group inline-flex items-center gap-2 py-1 text-sm text-ink-dim transition-colors hover:text-ink"
                  >
                    <span
                      aria-hidden
                      className="h-px w-0 bg-accent transition-all duration-300 group-hover:w-4"
                    />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Social */}
          <div>
            <h3 className="mb-4 font-display text-sm text-ink">
              Connect
            </h3>
            <div className="flex gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-11 w-11 items-center justify-center rounded-md border border-ink-dim/20 text-ink-faint transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:text-accent hover:shadow-card"
                  aria-label={social.label}
                >
                  <social.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-ink-dim/20 pt-6 sm:flex-row">
          <p className="case-number flex items-center gap-2">
            <span
              aria-hidden
              className="relative flex h-1.5 w-1.5 items-center justify-center"
            >
              <span className="absolute inset-0 rounded-full bg-accent/50 animate-dcph-pulse-ring" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            FILE NO. 001 · CLASSIFIED
          </p>
          <p className="text-xs text-ink-faint">
            &copy; {new Date().getFullYear()} Detective Conan PH. Not affiliated with Gosho Aoyama.
          </p>
        </div>
      </div>
    </footer>
  )
}