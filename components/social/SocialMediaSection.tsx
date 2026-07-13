import { Facebook, Instagram, Youtube, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

// Fetch from the `social_links` table (see schema) instead of hardcoding
// once the admin panel exists — this is the static v1 version.
const SOCIALS: {
  platform: string;
  handle: string;
  url: string;
  icon: ReactNode;
}[] = [
  {
    platform: "Facebook",
    handle: "@DetectiveConanPH",
    url: "https://facebook.com/DetectiveConanPH",
    icon: <Facebook className="h-5 w-5" />,
  },
  {
    platform: "Instagram",
    handle: "@detectiveconan.ph",
    url: "https://instagram.com/detectiveconan.ph",
    icon: <Instagram className="h-5 w-5" />,
  },
  {
    platform: "Discord",
    handle: "Join the Organization",
    url: "https://discord.gg/your-invite",
    icon: <MessageCircle className="h-5 w-5" />,
  },
  {
    platform: "YouTube",
    handle: "@DetectiveConanPH",
    url: "https://youtube.com/@DetectiveConanPH",
    icon: <Youtube className="h-5 w-5" />,
  },
];

export function SocialMediaSection() {
  return (
    <section aria-labelledby="socials-heading" className="mx-auto max-w-5xl px-6 py-16">
      <div className="mb-8 flex items-center gap-3">
        <span className="case-number">FILE NO. 002 — CONTACT</span>
        <span className="redacted-bar w-16" />
      </div>

      <h2 id="socials-heading" className="text-3xl mb-2">
        Stay in the network
      </h2>
      <p className="font-body text-dossier-cream-dim mb-10 max-w-xl">
        Every organization needs its channels. Follow along for drops,
        watch-party announcements, and community news.
      </p>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {SOCIALS.map((s) => (
          <li key={s.platform}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="dossier-card group flex flex-col gap-4 p-5 transition-colors hover:bg-case-file-raised focus-visible:bg-case-file-raised"
            >
              <span className="dossier-stamp">Verified</span>
              <span className="text-silver-steel group-hover:text-poison-red-bright transition-colors">
                {s.icon}
              </span>
              <div>
                <p className="font-display uppercase tracking-wide text-sm text-dossier-cream">
                  {s.platform}
                </p>
                <p className="case-number mt-1">{s.handle}</p>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
