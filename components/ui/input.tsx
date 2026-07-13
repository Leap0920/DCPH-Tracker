import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-sm border border-white/10 bg-case-file px-3 py-2 text-sm text-dossier-cream file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-dossier-cream-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-poison-red focus-visible:ring-offset-1 focus-visible:ring-offset-noir-black disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
