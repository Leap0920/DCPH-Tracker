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

export function Footer() {
  return (
    <footer className="border-t border-ink-dim/20 bg-surface">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <Link href="/" className="flex items-center gap-2 mb-4">
              <img
                src="/img/logo_DCPH.png"
                alt="Detective Conan PH Logo"
                className="h-8 w-auto object-contain transition-transform duration-300 hover:scale-105"
              />
              <span className="font-display text-lg text-ink">
                Detective Conan <span className="text-accent">PH</span>
              </span>
            </Link>
            <p className="text-sm text-ink-dim max-w-xs">
              The Filipino Detective Conan community: track episodes, join discussions,
              and prove your rank in the organization.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="font-display text-sm text-ink mb-4">
              Navigation
            </h3>
            <ul className="space-y-2">
              {footerLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-ink-dim hover:text-ink transition-colors py-1"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Social */}
          <div>
            <h3 className="font-display text-sm text-ink mb-4">
              Connect
            </h3>
            <div className="flex gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-11 w-11 rounded-md border border-ink-dim/20 flex items-center justify-center text-ink-faint hover:text-ink hover:border-ink-dim/30 transition-colors"
                  aria-label={social.label}
                >
                  <social.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-ink-dim/20 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="case-number">
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
