import type { ContentType } from "@/lib/constants"
import type { Database } from "@/types/database.types"
import { isOtherMovie } from "@/lib/movies-guide"

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
        label: "Official Movies",
        match: (e) => e.movie_number != null,
      },
      {
        key: "lupin",
        label: "Lupin III vs. Detective Conan",
        match: (e) => e.slug === "mov-37",
      },
      {
        key: "other",
        label: "Other Movies",
        match: (e) =>
          e.slug !== "mov-37" && (isOtherMovie(e.slug) || e.movie_number == null),
      },
    ],
  },
  ova: {
    label: "OVA",
    defaultKey: "ova",
    groups: [
      {
        key: "ova",
        label: "OVAs",
        match: (e) =>
          /\bOVA\s*\d+/i.test(e.title ?? "") ||
          e.slug === "ova-detective-conan-vs-wooo-01-02",
      },
      { key: "aoyama", label: "Gosho Aoyama's Short Stories", match: (e) => e.slug.includes("aoyama-short-stories") },
      { key: "secret", label: "Secret Files", match: (e) => e.slug.includes("secret-file") },
      { key: "magic", label: "Magic Files", match: (e) => e.slug.includes("magic-file") || /magic\s*file/i.test(e.title ?? "") },
      { key: "bonus", label: "Bonus Files", match: (e) => e.slug.includes("bonus-file") || /bonus file/i.test(e.title ?? "") },
      { key: "shogakukan", label: "Shogakukan Specials", match: (e) => e.slug.includes("shogakukan") },
      { key: "other", label: "Other OVAs", match: () => true },
    ],
  },
  special: {
    label: "Special",
    defaultKey: "tv",
    groups: [
      {
        key: "tv",
        label: "TV Specials",
        match: () => true, // after curation, every `special` row IS a TV special
      },
    ],
  },
  magic_kaito: {
    label: "Magic Kaito",
    defaultKey: "special",
    groups: [
      { key: "special", label: "Magic Kaito (2010)", match: (e) => e.slug.includes("mk-magic-kaito-special") },
      { key: "1412", label: "Magic Kaito 1412 (2014)", match: (e) => e.slug.includes("mk-magic-kaito-1412") },
    ],
  },
}

/** Returns the subcategory config for a content type, or undefined (no dropdown). */
export function getSubcategoryConfig(type: ContentType): SubcategoryConfig | undefined {
  return SUBCATEGORY_CONFIGS[type]
}