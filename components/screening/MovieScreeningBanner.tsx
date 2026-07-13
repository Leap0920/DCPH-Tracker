import { CalendarDays, MapPin, Ticket } from "lucide-react";

// Wire this up to a `screening_events` row where is_featured = true
// (see schema addition below). Hardcoded here as the v1 static version.
const FEATURED_SCREENING = {
  movieTitle: "Detective Conan: Fallen Angel of the Highway",
  movieNumber: 29,
  eventName: "DCPH Block Screening 2026",
  cinemaChain: "TBA — check official page",
  city: "Metro Manila",
  dateLabel: "Dates to be announced",
  ticketUrl: "#",
};

export function MovieScreeningBanner() {
  const s = FEATURED_SCREENING;

  return (
    <section aria-labelledby="screening-heading" className="mx-auto max-w-5xl px-6 py-16">
      <div className="mb-8 flex items-center gap-3">
        <span className="case-number">FILE NO. 029 — ACTIVE CASE</span>
        <span className="redacted-bar w-16" />
      </div>

      <div className="dossier-card p-8 sm:p-10 relative overflow-hidden">
        <span className="dossier-stamp">Incoming</span>

        <p className="case-number mb-3">MOVIE {String(s.movieNumber).padStart(2, "0")} · BLOCK SCREENING</p>

        <h2 id="screening-heading" className="text-3xl sm:text-4xl mb-4 max-w-xl">
          {s.movieTitle}
        </h2>

        <p className="font-body text-dossier-cream-dim max-w-xl mb-8">
          The organization gathers. Catch {s.eventName} with the rest of the
          PH community — details drop here the moment cinemas confirm.
        </p>

        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
          <div className="flex items-start gap-3">
            <MapPin className="h-5 w-5 text-poison-red-bright shrink-0" />
            <div>
              <dt className="case-number">Venue</dt>
              <dd className="font-body text-sm text-dossier-cream mt-1">{s.cinemaChain}</dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <CalendarDays className="h-5 w-5 text-poison-red-bright shrink-0" />
            <div>
              <dt className="case-number">Date</dt>
              <dd className="font-body text-sm text-dossier-cream mt-1">{s.dateLabel}</dd>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Ticket className="h-5 w-5 text-poison-red-bright shrink-0" />
            <div>
              <dt className="case-number">Tickets</dt>
              <dd className="font-body text-sm text-dossier-cream mt-1">{s.city}</dd>
            </div>
          </div>
        </dl>

        <a
          href={s.ticketUrl}
          className="inline-flex items-center gap-2 bg-poison-red hover:bg-poison-red-bright
                     transition-colors text-dossier-cream font-display uppercase tracking-wide
                     text-sm px-6 py-3 rounded-sm focus-visible:outline focus-visible:outline-2
                     focus-visible:outline-gold-seal"
        >
          Get notified
        </a>
      </div>
    </section>
  );
}
