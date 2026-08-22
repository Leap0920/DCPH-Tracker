/**
 * Canon / filler classification for the Detective Conan anime.
 *
 * SOURCE OF TRUTH: the two compact range strings below, transcribed verbatim
 * from animefillerlist.com. Do NOT hand-expand them into tuples — to re-sync
 * with the source, replace the string contents and nothing else. Parsing and
 * the lookup table are derived at module load (one pass, ~1.2 KB resident).
 *
 * Invariant: every episode in 1..MAX_EPISODE belongs to exactly one category.
 * Enforced by lib/__tests__/canon-guide.test.ts via validateCanonPartition().
 */

/** Category discriminators. */
export const CANON_TYPES = {
  MANGA: "manga_canon",
  FILLER: "filler",
  ANIME_CANON: "anime_canon",
} as const

export type CanonType = (typeof CANON_TYPES)[keyof typeof CANON_TYPES]

export const CANON_TYPE_LABELS: Record<CanonType, string> = {
  manga_canon: "Manga Canon",
  filler: "Filler",
  anime_canon: "Anime Canon",
}

/** Short explanation shown in the guide legend. */
export const CANON_TYPE_DESCRIPTIONS: Record<CanonType, string> = {
  manga_canon: "Adapted from Gosho Aoyama's manga — the main story.",
  filler: "Anime-original. Skippable without losing plot.",
  anime_canon: "Anime-original but story-relevant — don't skip.",
}

/** Stable display order for legends, filters and quick lists. */
export const CANON_TYPE_ORDER: readonly CanonType[] = [
  CANON_TYPES.MANGA,
  CANON_TYPES.FILLER,
  CANON_TYPES.ANIME_CANON,
]

export const CANON_GUIDE_SOURCE = "https://www.animefillerlist.com/shows/detective-conan"

/** Inclusive [start, end] episode range. */
export type EpisodeRange = readonly [number, number]

/* ───────────────────────── Raw source data ───────────────────────── */

const MANGA_CANON_RAW =
  "1-5, 7-13, 15-16, 18, 20, 22-23, 27-28, 31-32, 34-35, 38-40, 42-43, 46, 48-50, 52, 54, 57-58, 60, 63, 68-70, 72, 75-78, 81-82, 84-86, 91, 96, 98-105, 112-118, 121-122, 128-134, 136-139, 141-142, 144-147, 153-154, 156-157, 162-164, 166-168, 170-174, 176-178, 188-195, 199-200, 205-206, 212-213, 217-224, 226-231, 233-234, 238-244, 246-247, 249-250, 253-254, 258-259, 263, 266-272, 274-275, 277-280, 284-293, 301-302, 304-313, 316-317, 323-327, 329-336, 338-341, 343-347, 350-351, 354-356, 358-359, 361-362, 366-367, 371-372, 374-375, 381-383, 385-387, 390-391, 394-396, 398-402, 406-408, 411-412, 415-417, 421-422, 425, 427-432, 435-436, 438, 443-447, 449, 453-455, 457-458, 460, 462-467, 469-470, 472-474, 476-477, 479, 481-482, 484-485, 487-488, 490-511, 513-517, 521-526, 528-535, 537-538, 542-543, 545-546, 549-552, 557-561, 563-564, 568-569, 571-576, 578-581, 583-587, 589-590, 592-593, 597-598, 600-601, 608-628, 632-633, 642-657, 659-662, 667-668, 671-676, 681-685, 690-691, 699-706, 710-715, 722-725, 727-728, 731-732, 734, 738-741, 744-749, 751-752, 754-756, 759-760, 763-766, 770-773, 779-783, 785-788, 792-793, 808-812, 814-815, 822-823, 827-828, 830-832, 836-837, 843-844, 847-850, 853-854, 861-864, 866-867, 872-874, 878-879, 881-882, 885-890, 894-897, 901-902, 909-910, 916-917, 919-920, 925-928, 941-942, 952-954, 971-974, 983-984, 993-995, 1000-1001, 1003-1005, 1011-1012, 1018-1020, 1024-1025, 1029, 1033-1035, 1038, 1042, 1045-1046, 1053-1054, 1059-1061, 1071-1072, 1077-1079, 1085-1086, 1093-1094, 1098-1099, 1105-1106, 1109-1110, 1115-1116, 1123-1124, 1130-1131, 1135-1136, 1144-1145, 1148-1151, 1164-1167, 1169-1172, 1178-1179, 1184-1185, 1193-1194, 1204-1205"

const FILLER_RAW =
  "6, 14, 17, 19, 21, 24-26, 29-30, 33, 36-37, 41, 44-45, 47, 51, 53, 55-56, 59, 61-62, 64-67, 71, 73-74, 79-80, 83, 87-90, 92-95, 97, 106-111, 119-120, 123-127, 135, 140, 143, 148-152, 155, 158-161, 165, 169, 175, 179-187, 196-198, 201-204, 207-211, 214-216, 225, 232, 235-237, 245, 248, 251-252, 255-257, 260-262, 264-265, 273, 276, 281-283, 294-300, 303, 314-315, 318-322, 328, 337, 342, 348-349, 352-353, 357, 360, 363-365, 368-370, 373, 376-380, 384, 388-389, 392-393, 397, 403-405, 409-410, 413-414, 418-420, 423-424, 426, 433-434, 437, 439-442, 448, 450-452, 456, 459, 461, 468, 471, 475, 478, 480, 483, 486, 489, 512, 518-520, 527, 536, 539-541, 544, 547-548, 553-556, 562, 565-567, 570, 577, 582, 588, 591, 594-596, 599, 602-607, 629-631, 634-641, 658, 663-666, 669-670, 677-680, 686-689, 692-698, 707-709, 716-721, 726, 729-730, 733, 735-737, 742-743, 750, 753, 757-758, 761-762, 767-769, 774-778, 784, 789-791, 794-807, 813, 816-821, 824-826, 829, 833-835, 838-842, 845-846, 851-852, 855-860, 865, 868-871, 875-877, 880, 883-884, 891-893, 898-900, 903-908, 911-915, 918, 921-924, 929-940, 943-951, 955-970, 975-982, 985-992, 996-999, 1002, 1006-1010, 1013-1017, 1021-1023, 1026-1028, 1030-1032, 1036-1037, 1039-1041, 1043-1044, 1047-1052, 1055-1058, 1062-1070, 1073-1076, 1080-1084, 1087-1092, 1095-1097, 1100-1104, 1107-1108, 1111-1114, 1117-1122, 1125-1129, 1132-1134, 1137-1143, 1146-1147, 1152-1163, 1168, 1173-1177, 1180-1183, 1186, 1188-1192, 1195-1203, 1206-1212"

const ANIME_CANON_RAW = "1187"

/* ───────────────────────── Parsing ───────────────────────── */

/** Malformed tokens found while parsing, surfaced by validateCanonPartition(). */
const malformedTokens: string[] = []

function parseRanges(raw: string, label: string): EpisodeRange[] {
  const out: EpisodeRange[] = []
  for (const chunk of raw.split(",")) {
    const token = chunk.trim()
    if (!token) continue
    const dash = token.indexOf("-")
    if (dash === -1) {
      const n = Number.parseInt(token, 10)
      if (Number.isInteger(n) && n > 0) out.push([n, n])
      else malformedTokens.push(`${label}: "${token}"`)
      continue
    }
    const start = Number.parseInt(token.slice(0, dash), 10)
    const end = Number.parseInt(token.slice(dash + 1), 10)
    if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
      out.push([start, end])
    } else {
      malformedTokens.push(`${label}: "${token}"`)
    }
  }
  return out
}

export const MANGA_CANON_RANGES: readonly EpisodeRange[] = parseRanges(MANGA_CANON_RAW, "manga_canon")
export const FILLER_RANGES: readonly EpisodeRange[] = parseRanges(FILLER_RAW, "filler")
export const ANIME_CANON_RANGES: readonly EpisodeRange[] = parseRanges(ANIME_CANON_RAW, "anime_canon")

const RANGES_BY_TYPE: Record<CanonType, readonly EpisodeRange[]> = {
  manga_canon: MANGA_CANON_RANGES,
  filler: FILLER_RANGES,
  anime_canon: ANIME_CANON_RANGES,
}

export function canonRangesFor(type: CanonType): readonly EpisodeRange[] {
  return RANGES_BY_TYPE[type]
}

/** Highest episode number covered by the source data. */
export const MAX_EPISODE: number = (() => {
  let max = 0
  for (const type of CANON_TYPE_ORDER) {
    for (const [, end] of RANGES_BY_TYPE[type]) if (end > max) max = end
  }
  return max
})()

/* ───────────────────────── Lookup table ───────────────────────── */

const CODE_UNCLASSIFIED = 0
const CODE_MANGA = 1
const CODE_FILLER = 2
const CODE_ANIME_CANON = 3

const CODE_BY_TYPE: Record<CanonType, number> = {
  manga_canon: CODE_MANGA,
  filler: CODE_FILLER,
  anime_canon: CODE_ANIME_CANON,
}

const TYPE_BY_CODE: (CanonType | null)[] = [null, "manga_canon", "filler", "anime_canon"]

/** episode number -> category code. Index 0 unused. */
const TABLE = new Uint8Array(MAX_EPISODE + 1)

/** How many categories claim each episode — kept for the partition check. */
const CLAIMS = new Uint8Array(MAX_EPISODE + 1)

for (const type of CANON_TYPE_ORDER) {
  const code = CODE_BY_TYPE[type]
  for (const [start, end] of RANGES_BY_TYPE[type]) {
    for (let n = start; n <= end; n++) {
      if (n < 1 || n > MAX_EPISODE) continue
      TABLE[n] = code
      CLAIMS[n] = CLAIMS[n] + 1
    }
  }
}

/**
 * Classify an episode number. Returns null for anything outside 1..MAX_EPISODE
 * and for numbers the source data does not classify (should be none — see the
 * partition test — but future DB rows beyond the guide land here).
 */
export function canonTypeForEpisode(episodeNumber: number | null | undefined): CanonType | null {
  if (typeof episodeNumber !== "number" || !Number.isInteger(episodeNumber)) return null
  if (episodeNumber < 1 || episodeNumber > MAX_EPISODE) return null
  const code = TABLE[episodeNumber]
  return code === CODE_UNCLASSIFIED ? null : TYPE_BY_CODE[code]
}

/** Total episodes claimed by a category, per the source ranges. */
export function canonRangeTotal(type: CanonType): number {
  let total = 0
  for (const [start, end] of RANGES_BY_TYPE[type]) total += end - start + 1
  return total
}

/** "5" for a single episode, "1-5" for a span (matches the source formatting). */
export function formatEpisodeRange([start, end]: EpisodeRange): string {
  return start === end ? String(start) : `${start}-${end}`
}

/* ───────────────────────── Invariant check (test-facing) ───────────────────────── */

export interface CanonPartitionReport {
  ok: boolean
  /** Episodes claimed by more than one category. */
  duplicates: number[]
  /** Episodes in 1..MAX_EPISODE claimed by no category. */
  missing: number[]
  /** Tokens the parser could not read. */
  malformed: string[]
}

/**
 * Verifies that 1..MAX_EPISODE is partitioned exactly once across the three
 * categories. Pure; safe to call from tests or a dev-only assertion.
 */
export function validateCanonPartition(): CanonPartitionReport {
  const duplicates: number[] = []
  const missing: number[] = []
  for (let n = 1; n <= MAX_EPISODE; n++) {
    const claims = CLAIMS[n]
    if (claims === 0) missing.push(n)
    else if (claims > 1) duplicates.push(n)
  }
  return {
    ok: duplicates.length === 0 && missing.length === 0 && malformedTokens.length === 0,
    duplicates,
    missing,
    malformed: [...malformedTokens],
  }
}
