import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-display uppercase tracking-wide text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-seal focus-visible:ring-offset-2 focus-visible:ring-offset-noir-black disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-poison-red text-dossier-cream hover:bg-[#630f18]",
        destructive:
          "bg-poison-red text-dossier-cream hover:bg-[#630f18]",
        outline:
          "border border-white/10 bg-transparent text-dossier-cream hover:bg-case-file-raised",
        secondary:
          "bg-case-file-raised text-dossier-cream hover:bg-case-file",
        ghost:
          "text-silver-steel hover:bg-case-file-raised hover:text-dossier-cream",
        link:
          "text-poison-red-bright underline-offset-4 hover:underline",
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
