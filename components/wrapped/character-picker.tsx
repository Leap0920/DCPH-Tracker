"use client"

import { useMemo, useState } from "react"
import { Check, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  WRAPPED_BACKGROUNDS,
  backgroundSrc,
  type WrappedBackground,
} from "@/lib/wrapped/characters"
import { cn } from "@/lib/utils"

type Props = {
  value: string
  onChange: (id: string) => void
}

function Thumb({
  bg,
  selected,
  onSelect,
}: {
  bg: WrappedBackground
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Use ${bg.name} as background`}
      className={cn(
        "group relative block aspect-[3/4] w-full shrink-0 overflow-hidden rounded-xl",
        "border bg-[#141414] text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        selected
          ? "border-accent ring-2 ring-accent shadow-md shadow-accent/20"
          : "border-white/10 hover:border-white/30"
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={backgroundSrc(bg.file)}
        alt={bg.name}
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-2.5 pt-7">
        <span className="block truncate text-xs font-medium text-white/90 group-hover:text-white">
          {bg.name}
        </span>
      </div>
      {selected ? (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white shadow">
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </span>
      ) : null}
    </button>
  )
}

export function CharacterPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return WRAPPED_BACKGROUNDS
    return WRAPPED_BACKGROUNDS.filter((b) => b.name.toLowerCase().includes(q))
  }, [query])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
          Background
        </span>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-ink-dim hover:text-white">
              Browse all ({WRAPPED_BACKGROUNDS.length})
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl border-line bg-[#0A0A0A] p-6">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-white">Choose a background</DialogTitle>
            </DialogHeader>

            <div className="relative my-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search characters by name (e.g. Conan, Akai, Kid...)"
                className="h-10 border-white/15 bg-white/[0.04] pl-9 text-sm text-white placeholder:text-white/40 focus-visible:border-accent"
              />
            </div>

            <div className="max-h-[60vh] overflow-y-auto pr-1">
              {filtered.length === 0 ? (
                <p className="py-12 text-center text-sm text-ink-dim">No characters found for &ldquo;{query}&rdquo;.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {filtered.map((bg) => (
                    <Thumb
                      key={bg.id}
                      bg={bg}
                      selected={bg.id === value}
                      onSelect={() => {
                        onChange(bg.id)
                        setOpen(false)
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* quick strip */}
      <div className="grid grid-cols-5 gap-2">
        {WRAPPED_BACKGROUNDS.slice(0, 5).map((bg) => (
          <Thumb
            key={bg.id}
            bg={bg}
            selected={bg.id === value}
            onSelect={() => onChange(bg.id)}
          />
        ))}
      </div>
    </div>
  )
}
