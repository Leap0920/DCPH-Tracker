import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-mono uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-gold-seal",
  {
    variants: {
      variant: {
        default:
          "border-poison-red/40 bg-poison-red/20 text-poison-red-bright",
        secondary:
          "border-white/10 bg-case-file-raised text-silver-steel",
        outline:
          "border-white/10 bg-transparent text-dossier-cream-dim",
        gold:
          "border-gold-seal/40 bg-gold-seal/20 text-gold-seal",
      },
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

export { Badge, badgeVariants }
