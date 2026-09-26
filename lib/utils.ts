import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { defaultRuntimeMinutes } from "@/lib/runtime-defaults";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Pad a number with leading zeros */
export function padNumber(n: number, length = 2): string {
  return String(n).padStart(length, "0");
}

/** Format a date to a readable string */
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

/** Format a minute count as a compact duration string (e.g. 2h 30m) */
export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Default runtime (minutes) for a content type when the DB has no runtime stored.
 *
 * Delegates to lib/runtime-defaults so analytics, profile and the sync importer
 * all price a missing runtime the same way — this used to be a second table
 * (movie 100 / special 45) that disagreed with the DB migration's (110 / 46).
 */
export function getDefaultRuntime(type: string): number {
  return defaultRuntimeMinutes(type)
}

/** Format an ISO timestamp as a compact relative time (e.g. "just now", "3h ago", "5d ago") */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return formatDate(iso);
}
