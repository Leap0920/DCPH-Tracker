import Link from "next/link"
import { Facebook, Instagram, Youtube, MessageCircle } from "lucide-react"

const footerLinks = [
  { label: "Tracker", href: "/tracker" },
  { label: "Story Arcs", href: "/arcs" },
  { label: "Rankings", href: "/community/rankings" },
  { label: "Chat", href: "/community/chat/general" },
]

const socialLinks = [
  { icon: Facebook, href: "https://facebook.com/DetectiveConanPH", label: "Facebook" },
  { icon: Instagram, href: "https://instagram.com/detectiveconan.ph", label: "Instagram" },
  { icon: Youtube, href: "https://youtube.com/@DetectiveConanPH", label: "YouTube" },
  { icon: MessageCircle, href: "https://discord.gg/your-invite", label: "Discord" },
]

export function Footer() {
  return (
    <footer className="border-t border-white/5 bg-noir-black">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <Link href="/" className="flex items-center gap-3 mb-4">
              <div className="h-8 w-8 rounded-sm bg-poison-red flex items-center justify-center">
                <span className="font-display text-sm font-bold text-dossier-cream">DC</span>
              </div>
              <span className="font-display text-lg uppercase tracking-wide text-dossier-cream">
                Detective Conan <span className="text-poison-red-bright">PH</span>
              </span>
            </Link>
            <p className="text-sm text-dossier-cream-dim max-w-xs">
              The Filipino Detective Conan community — track episodes, join discussions,
              and prove your rank in the organization.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="font-display text-sm uppercase tracking-wide text-silver-steel mb-4">
              Navigation
            </h3>
            <ul className="space-y-2">
              {footerLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-dossier-cream-dim hover:text-dossier-cream transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Social */}
          <div>
            <h3 className="font-display text-sm uppercase tracking-wide text-silver-steel mb-4">
              Connect
            </h3>
            <div className="flex gap-3">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-9 w-9 rounded-sm border border-white/10 flex items-center justify-center text-silver-steel hover:text-poison-red-bright hover:border-poison-red/40 transition-colors"
                  aria-label={social.label}
                >
                  <social.icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="case-number">
            FILE NO. 001 — CLASSIFIED
          </p>
          <p className="text-xs text-dossier-cream-dim">
            &copy; {new Date().getFullYear()} Detective Conan PH. Not affiliated with Gosho Aoyama.
          </p>
        </div>
      </div>
    </footer>
  )
}
