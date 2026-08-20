import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Notes on the two colour decisions here:
 * - `default` fills with --accent (#C8102E); white on it is 6:1, so it is
 *   the only accent surface safe for small label text.
 * - `link` uses --accent-bright, because plain --accent is 3.3:1 against
 *   the near-black page and fails as text.
 * - `destructive` uses --danger, deliberately NOT the brand crimson, so a
 *   destructive action stays visually distinct from a primary one.
 *
 * Focus ring offsets against `page` rather than `surface`: most buttons sit
 * on the page background, and an offset ring matching the wrong colour
 * punches a visible notch in the halo.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-display text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-bright focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-accent text-white hover:bg-accent-bright",
        destructive:
          "bg-danger text-white hover:bg-danger/85",
        outline:
          "border border-line bg-transparent text-ink hover:bg-surface-muted",
        secondary:
          "bg-surface-muted text-ink hover:bg-line",
        ghost:
          "text-ink-dim hover:bg-surface-muted hover:text-ink",
        link:
          "text-accent-bright underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }