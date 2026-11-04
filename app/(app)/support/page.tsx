import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowLeft,
  Database,
  HardDrive,
  HeartHandshake,
  MessageSquare,
  Server,
  ShieldCheck,
} from "lucide-react"
import { SUPPORT_METHODS, SUPPORT_USES } from "@/lib/support"
import { SupportQrCard } from "@/components/support/SupportQrCard"

export const metadata: Metadata = {
  title: "Support",
  description:
    "Keep the Detective Conan PH tracker free — what the running costs are, and how to send a donation.",
}

const USE_ICONS = {
  server: Server,
  storage: HardDrive,
  "no-ads": ShieldCheck,
} as const

const FAQ = [
  {
    q: "Do I get anything for donating?",
    a: "No. The tracker is already the same for everyone: no donor badge, no rank boost, no early access. Donations only cover the bills.",
  },
  {
    q: "Is my progress affected if I never donate?",
    a: "Not at all. Watch history, ratings and streaks are unrelated to donations and are never gated.",
  },
  {
    q: "Can I see where the money goes?",
    a: "Roughly: hosting and the domain, then database and image storage. There is no company behind this — it is one person running a fan project.",
  },
]

export default function SupportPage() {
  return (
    <div className="px-4 pb-24 pt-10 sm:px-6 lg:py-16">
      <div className="mx-auto max-w-5xl">
        {/* ── Header ── */}
        <header className="max-w-2xl">
          <p className="case-number flex items-center gap-2 text-ink-faint">
            <HeartHandshake className="h-3.5 w-3.5 text-accent-bright" />
            Support the case files
          </p>
          <h1 className="mt-3 font-display text-3xl leading-tight tracking-tight text-ink sm:text-4xl">
            Keep the tracker free
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-dim">
            Tracking 1,200+ episodes should not cost you anything. The server, the
            database and the episode artwork behind it do cost something, and donations
            are how that gets covered — no ads, no paywall, nothing locked behind it.
          </p>
        </header>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8">
          {/* ── Why ── */}
          <div className="order-2 space-y-8 lg:order-1">
            <section aria-labelledby="support-uses">
              <h2 id="support-uses" className="font-display text-lg tracking-tight text-ink">
                What your donation pays for
              </h2>
              <ul className="mt-4 space-y-3">
                {SUPPORT_USES.map((use) => {
                  const Icon = USE_ICONS[use.icon]
                  return (
                    <li
                      key={use.title}
                      className="flex gap-3.5 rounded-xl border border-line bg-surface p-4"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-ink-dim">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-display text-sm text-ink">{use.title}</p>
                        <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">
                          {use.body}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section aria-labelledby="support-other">
              <h2 id="support-other" className="font-display text-lg tracking-tight text-ink">
                Other ways to help
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
                Sharing the tracker with one Conan fan does more than a small donation —
                and a bug report saves a whole evening of guessing.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/community/chat"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 font-display text-xs text-ink transition-colors hover:border-ink-faint"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Report a problem
                </Link>
                <Link
                  href="/tracker"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 font-display text-xs text-ink transition-colors hover:border-ink-faint"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to the tracker
                </Link>
              </div>
            </section>

            <section aria-labelledby="support-faq">
              <h2 id="support-faq" className="font-display text-lg tracking-tight text-ink">
                Common questions
              </h2>
              <div className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {FAQ.map((item) => (
                  <details key={item.q} className="group px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-display text-sm text-ink marker:hidden">
                      {item.q}
                      <span
                        aria-hidden
                        className="text-ink-faint transition-transform group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{item.a}</p>
                  </details>
                ))}
              </div>
            </section>
          </div>

          {/* ── How ── */}
          <section aria-labelledby="support-how" className="order-1 lg:order-2">
            <h2 id="support-how" className="font-display text-lg tracking-tight text-ink">
              Send a donation
            </h2>
            <div className="mt-4 space-y-4">
              {SUPPORT_METHODS.map((method) => (
                <SupportQrCard key={method.id} method={method} />
              ))}
            </div>
            <p className="mt-4 text-[12px] leading-relaxed text-ink-dim">
              Donations are voluntary and non-refundable. They do not unlock features,
              ranks or badges.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
