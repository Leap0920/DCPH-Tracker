"use client"

/**
 * The tracker's labelled dropdown.
 *
 * The old toolbar had three bare selects with no labels, a 12px mono font and
 * no indication of what they controlled — "Story Order" was one of four values
 * behind an unlabelled chevron. This puts the field name above the value and a
 * one-line explanation under each option, because "Canon Guide" vs "Story
 * Order" is not self-explanatory and a dropdown is the wrong place to make
 * someone guess.
 *
 * The trigger is borderless and transparent: it sits inside the toolbar's one
 * control surface, so a row of four bordered boxes became one bar with four
 * fields in it. The leading icon went too — the label already names the field.
 *
 * It does NOT use components/ui/select's SelectTrigger: that trigger forces
 * `[&>span]:line-clamp-1` on every direct child, which turns the icon wrapper
 * into a -webkit-box and kills its centring. Radix's primitive is used directly
 * for the trigger and the shared SelectContent/SelectItem for the menu.
 */

import * as SelectPrimitive from "@radix-ui/react-select"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem } from "@/components/ui/select"

export interface FilterOption {
  value: string
  label: string
  /** One line explaining what the option does. Shown in the menu only. */
  hint?: string
}

interface FilterSelectProps {
  /** Field name, e.g. "Order". Rendered small-caps above the value. */
  label: string
  value: string
  options: readonly FilterOption[]
  onChange: (value: string) => void
  className?: string
}

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  className,
}: FilterSelectProps) {
  const selected = options.find((option) => option.value === value)

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger
        aria-label={label}
        className={cn(
          "group flex h-8 w-full items-center gap-1.5 rounded-md px-2.5 text-left",
          "transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40",
          "data-[state=open]:bg-surface-muted",
          className
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[8px] uppercase leading-none tracking-[0.14em] text-ink-faint">
            {label}
          </span>
          <span className="mt-1 block truncate text-[12px] font-medium leading-tight text-ink">
            {selected?.label ?? "—"}
          </span>
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="h-3 w-3 shrink-0 text-ink-faint transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectContent
        position="popper"
        className="max-h-[min(26rem,70vh)] w-[var(--radix-select-trigger-width)] min-w-[17rem] rounded-xl border-line p-1.5"
      >
        {options.map((option) => {
          const isSelected = option.value === value
          return (
            <SelectItem
              key={option.value}
              value={option.value}
              className={cn(
                "rounded-lg py-2 pl-9 pr-3",
                isSelected && "bg-surface-muted/60"
              )}
            >
              <span className="flex flex-col gap-0.5">
                <span
                  className={cn(
                    "text-[13px] leading-tight",
                    isSelected ? "text-ink" : "text-ink-dim"
                  )}
                >
                  {option.label}
                </span>
                {option.hint && (
                  <span className="text-[11px] leading-snug text-ink-faint">{option.hint}</span>
                )}
              </span>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}
