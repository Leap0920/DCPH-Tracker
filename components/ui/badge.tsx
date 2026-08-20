import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Tone table — the only place badge colours are written down. Lives here
 * rather than in lib/badges.ts because Tailwind only scans ./app and
 * ./components for class literals.
 */
const badgeTone = {
  default: "border-accent/40 bg-accent-soft text-accent-bright",
  secondary: "border-line bg-surface-muted text-ink-dim",
  outline: "border-line bg-transparent text-ink-dim",
  gold: "border-gold-seal/40 bg-gold-seal/10 text-gold-seal",
}

export type BadgeVariant = keyof typeof badgeTone

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-accent",
  {
    variants: {
      variant: badgeTone,
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants, badgeTone }
