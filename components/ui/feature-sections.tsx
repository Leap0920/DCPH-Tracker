import Link from "next/link";
import Image from "next/image";
import { UserPlus, ListChecks, Trophy, ArrowRight } from "lucide-react";

export default function FeatureSections() {
  return (
    <section className="w-full py-16 bg-surface">
      <div className="text-center max-w-2xl mx-auto mb-12 px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent dark:text-accent-bright">How it works</span>
        <h2 className="text-3xl font-bold font-display text-ink mt-1">From zero to full detective</h2>
        <p className="text-sm text-ink-dim mt-2 font-body">
          Three simple steps to start tracking, ranking, and chatting with the community.
        </p>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-12 max-w-6xl mx-auto px-6">
        {/* Left Side: Overlapping image cards (Shinichi & Jinpei) */}
        <div className="relative w-full max-w-md h-[360px] sm:h-[420px]">
          <div className="absolute top-0 left-2 sm:left-4 w-60 sm:w-72 h-72 sm:h-88 overflow-hidden rounded-3xl border border-ink-dim/20 shadow-lg -rotate-3 hover:rotate-0 transition-all duration-500">
            <Image
              src="/img/shinichi.jpg"
              alt="Shinichi Kudo"
              fill
              sizes="(max-width: 640px) 240px, 288px"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="absolute bottom-0 right-2 sm:right-4 z-10 w-60 sm:w-72 h-72 sm:h-88 overflow-hidden rounded-3xl border-2 border-white shadow-2xl rotate-3 hover:rotate-0 transition-all duration-500">
            <Image
              src="/img/Jinpei.jpg"
              alt="Jinpei Matsuda"
              fill
              sizes="(max-width: 640px) 240px, 288px"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </div>
        </div>

        {/* Right Side: Circular icon feature list */}
        <div className="space-y-8 w-full max-w-lg">
          <div className="flex items-start gap-6 group">
            <div className="p-4 aspect-square bg-violet-100 rounded-full flex items-center justify-center text-violet-600 shrink-0 shadow-sm transition-transform group-hover:scale-110">
              <UserPlus className="w-7 h-7" />
            </div>
            <div className="space-y-1.5 pt-1">
              <h3 className="text-base font-semibold font-display text-ink">Create your account</h3>
              <p className="text-sm text-ink-dim leading-relaxed">Sign up in under a minute with just an email, no credit card, no fuss.</p>
              <Link href="/signup" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:gap-2 transition-all pt-1">
                Create account <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <div className="flex items-start gap-6 group">
            <div className="p-4 aspect-square bg-green-500/10 rounded-full flex items-center justify-center text-green-400 shrink-0 shadow-sm transition-transform group-hover:scale-110">
              <ListChecks className="w-7 h-7" />
            </div>
            <div className="space-y-1.5 pt-1">
              <h3 className="text-base font-semibold font-display text-ink">Track what you watch</h3>
              <p className="text-sm text-ink-dim leading-relaxed">Log every episode, movie, special and OVA as you go and watch your progress fill in.</p>
              <Link href="/tracker" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:gap-2 transition-all pt-1">
                Start tracking <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          <div className="flex items-start gap-6 group">
            <div className="p-4 aspect-square bg-orange-100 rounded-full flex items-center justify-center text-orange-600 shrink-0 shadow-sm transition-transform group-hover:scale-110">
              <Trophy className="w-7 h-7" />
            </div>
            <div className="space-y-1.5 pt-1">
              <h3 className="text-base font-semibold font-display text-ink">Compete with fellow detectives</h3>
              <p className="text-sm text-ink-dim leading-relaxed">Climb the detective rankings and talk cases with the community in themed chat rooms.</p>
              <Link href="/community/rankings" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:gap-2 transition-all pt-1">
                See rankings <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
