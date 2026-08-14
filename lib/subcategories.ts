import type { ContentType } from "@/lib/constants"
import type { Database } from "@/types/database.types"

type ContentEntry = Database["public"]["Tables"]["content_entries"]["Row"]

export interface SubcategoryGroup {
  key: string
  label: string
  /** Returns true when the entry belongs to this group. Groups are evaluated in order; first match wins. */
  match: (entry: ContentEntry) => boolean
}

export interface SubcategoryConfig {
  /** Section label (used as dropdown placeholder context). */
  label: string
  /** Group key selected by default (e.g. "official" for movies). */
  defaultKey: string
  /** Groups evaluated in order; first match wins. */
  groups: SubcategoryGroup[]
}

export const SUBCATEGORY_CONFIGS: Partial<Record<ContentType, SubcategoryConfig>> = {
  movie: {
    label: "Movie",
    defaultKey: "official",
    groups: [
      {
        key: "official",
        label: "Official Movie",
        match: (e) => typeof e.movie_number === "number" && e.movie_number >= 1 && e.movie_number <= 29,
      },
      { key: "lupin", label: "Lupin III vs Conan", match: (e) => e.slug === "mov-37" },
      { key: "kid", label: "Conan vs Kid", match: (e) => e.slug === "mov-19" || e.slug === "mov-22" },
      {
        key: "other",
        label: "Other Movies",
        match: () => true,
      },
    ],
  },
  ova: {
    label: "OVA",
    defaultKey: "ova",
    groups: [
      {
        key: "ova",
        label: "OVA",
        match: (e) => e.slug === "ova-01" || e.slug === "ova-detective-conan-vs-wooo-01-02",
      },
      { key: "aoyama", label: "Aoyama Short Stories", match: (e) => e.slug.includes("aoyama-short-stories") },
      { key: "secret", label: "Secret Files", match: (e) => e.slug.includes("secret-file") },
      { key: "magic", label: "Magic File", match: (e) => e.slug.includes("magic-file") },
      { key: "bonus", label: "Bonus File", match: (e) => e.slug.includes("bonus-file") },
      { key: "shogakukan", label: "Shogakukan", match: (e) => e.slug.includes("shogakukan") },
    ],
  },
  special: {
    label: "Special",
    defaultKey: "tv",
    groups: [
      {
        key: "tv",
        label: "TV Specials",
        match: (e) => e.slug.startsWith("sp-") || e.slug === "special-lupin-vs-conan-2009",
      },
      { key: "crossover", label: "Cross-over Movies", match: (e) => e.slug.includes("cross-over-movie") },
      { key: "compilation", label: "Compilation Movies", match: (e) => e.slug.includes("compilation-movie") },
    ],
  },
  magic_kaito: {
    label: "Magic Kaito",
    defaultKey: "special",
    groups: [
      { key: "special", label: "Magic Kaito Specials", match: (e) => e.slug.includes("mk-magic-kaito-special") },
      { key: "1412", label: "Magic Kaito 1412", match: (e) => e.slug.includes("mk-magic-kaito-1412") },
    ],
  },
}

/** Returns the subcategory config for a content type, or undefined (no dropdown). */
export function getSubcategoryConfig(type: ContentType): SubcategoryConfig | undefined {
  return SUBCATEGORY_CONFIGS[type]
}