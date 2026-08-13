"use client"

import Link from "next/link"
import { UserPlus, ListChecks, Trophy } from "lucide-react"
import { openAuthModal, type AuthModalMode } from "@/lib/auth-modal"

const steps: Array<{
  number: string
  icon: typeof UserPlus
  title: string
  body: string
  cta: string
  href: string
  modalMode?: AuthModalMode
}> = [
  {
    number: "01",
    icon: UserPlus,
    title: "Create your account",
    body: "Sign up in under a minute with just an email — no credit card, no fuss.",
    cta: "Create account",
    href: "/signup",
    modalMode: "signup",
  },
  {
    number: "02",
    icon: ListChecks,
    title: "Track what you watch",
    body: "Log every episode, movie, special and OVA as you go and watch your progress fill in.",
    cta: "Start tracking",
    href: "/tracker",
  },
  {
    number: "03",
    icon: Trophy,
    title: "Compete with fellow detectives",
    body: "Climb the detective rankings and talk cases with the community in themed chat rooms.",
    cta: "See rankings",
    href: "/community/rankings",
  },
]

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-5xl px-6">
      <h2 className="font-display text-2xl sm:text-3xl text-center text-ink">
        How it works
      </h2>
      <p className="mt-2 text-center text-ink-dim max-w-xl mx-auto">
        From zero to full detective in three simple steps.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-3">
        {steps.map((step) => {
          const Icon = step.icon
          const linkClasses =
            "mt-4 inline-block text-sm font-semibold text-accent hover:text-accent-bright"
          return (
            <div
              key={step.number}
              className="relative rounded-lg border border-slate-200 bg-surface p-6 pt-8 shadow-card"
            >
              <span className="font-mono text-xs tracking-widest text-ink-faint">
                {step.number}
              </span>
              <span className="mt-3 flex h-10 w-10 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-lg text-ink">{step.title}</h3>
              <p className="mt-2 text-sm text-ink-dim">{step.body}</p>
              {step.modalMode ? (
                <button
                  type="button"
                  onClick={() => openAuthModal(step.modalMode!)}
                  className={linkClasses}
                >
                  {step.cta} →
                </button>
              ) : (
                <Link href={step.href} className={linkClasses}>
                  {step.cta} →
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
