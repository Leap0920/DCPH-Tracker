"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"

export interface CtaProps {
  ctaEnabled: boolean
  text: string
  link: string
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
  target?: string
}

export function Cta({ cta }: { cta: CtaProps }) {
  if (!cta?.ctaEnabled) return null

  const isExternal = cta.link.startsWith("http://") || cta.link.startsWith("https://")

  return (
    <Button
      variant={cta.variant ?? "default"}
      size={cta.size ?? "default"}
      asChild
      className={
        cta.variant === "default"
          ? "bg-accent hover:bg-accent-bright text-white rounded-full font-semibold shadow-md px-6 h-11 text-sm font-display transition-all hover:scale-[1.02]"
          : "rounded-full border border-ink-dim/30 font-semibold px-6 h-11 text-sm font-display text-ink-dim hover:text-ink hover:border-ink-dim/40 transition-all bg-surface"
      }
    >
      <a
        href={cta.link}
        target={cta.target ?? (isExternal ? "_blank" : undefined)}
        rel={isExternal ? "noopener noreferrer" : undefined}
      >
        {cta.text}
      </a>
    </Button>
  )
}
