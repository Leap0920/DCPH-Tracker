"use client"

import * as React from "react"
import Image, { type ImageProps } from "next/image"
import { cn } from "@/lib/utils"

type RemoteImageProps = Omit<ImageProps, "src" | "alt" | "fill"> & {
  src?: string | null
  alt: string
  /** Tailwind classes for the wrapper. Must resolve a height (aspect or h-*). */
  wrapperClassName?: string
  /** Rendered when src is missing or the image fails to load. */
  fallback?: React.ReactNode
}

export function RemoteImage({
  src,
  alt,
  wrapperClassName,
  className,
  fallback = null,
  sizes = "(max-width: 640px) 50vw, 25vw",
  ...rest
}: RemoteImageProps) {
  const [failed, setFailed] = React.useState(false)

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-surface-muted",
        wrapperClassName
      )}
    >
      {src && !failed ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className={cn("object-cover", className)}
          onError={() => setFailed(true)}
          {...rest}
        />
      ) : (
        fallback
      )}
    </div>
  )
}
