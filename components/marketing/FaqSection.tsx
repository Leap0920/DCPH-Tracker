import { ChevronDown } from "lucide-react"

const faqs = [
  {
    q: "Is Detective Conan PH free to use?",
    a: "Yes — completely free. The tracker, story arcs, rankings and community chat are all available without paying anything, now and in the future.",
  },
  {
    q: "Do I need an account to track episodes?",
    a: "Yes. Creating a free account lets your watch progress sync and stay saved. You can still browse the episode list and story arcs without logging in.",
  },
  {
    q: "How often is the episode list updated?",
    a: "New entries are synced automatically as episodes air, so the tracker always reflects the latest Detective Conan content, including movies, specials and OVAs.",
  },
  {
    q: "What counts as an episode in my progress?",
    a: "Everything — TV episodes, movies, specials, OVAs, live actions and spin-offs all count toward your totals and your agent rank.",
  },
  {
    q: "Is there a mobile app?",
    a: "Not yet, but the site is built to work great on phones. You can add it to your home screen from your browser for an app-like experience.",
  },
  {
    q: "How can I report a problem or suggest a feature?",
    a: "Drop into the community chat and let us know — the team and other agents are usually around to help.",
  },
]

export function FaqSection() {
  return (
    <section className="mx-auto max-w-2xl px-6">
      <h2 className="font-display text-2xl sm:text-3xl text-center text-ink">
        Frequently asked questions
      </h2>
      <p className="mt-2 text-center text-ink-dim">
        Everything you need to know before you start tracking.
      </p>

      <div className="mt-10 space-y-3">
        {faqs.map((faq) => (
          <details
            key={faq.q}
            className="group rounded-lg border border-slate-200 bg-surface px-5 shadow-card"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-display text-sm sm:text-base font-medium text-ink [&::-webkit-details-marker]:hidden">
              {faq.q}
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <p className="pb-4 text-sm leading-relaxed text-ink-dim">{faq.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
