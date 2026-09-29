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

/**
 * UUID v4 that also works on insecure origins.
 *
 * `crypto.randomUUID` is only exposed in secure contexts (HTTPS or localhost),
 * so a dev server opened over plain HTTP — e.g. http://192.168.x.x:3000 from a
 * phone — throws "crypto.randomUUID is not a function". `getRandomValues` has
 * no such restriction, so the v4 is assembled from random bytes instead; only
 * where even that is missing does it degrade to Math.random, which is fine for
 * an id that has to be unique rather than unpredictable.
 */
export function randomId(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Returns the URL only when it is an absolute http(s) address, else null.
 *
 * For links built from data we do not control — third-party API responses
 * (the wiki lookup) and model output echoed into the chat. React already
 * refuses to run a `javascript:` href, but the other schemes are worth
 * rejecting outright, and an explicit guard at the call site documents that
 * the value is untrusted.
 */
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    // Not an absolute URL — a relative one is fine for our own routes, but
    // this helper is only used for outbound links, so refuse it.
    return null;
  }
}
