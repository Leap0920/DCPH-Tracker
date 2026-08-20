/**
 * Crime taxonomy for Detective Conan content.
 *
 * The taxonomy is the source of truth in CODE, not in the database. The DB only
 * ever stores slugs (content_entries.crime_types text[]). That keeps labels,
 * ordering, icons and descriptions shippable in a normal PR with no migration.
 *
 * IMPORTANT: no Tailwind class literals in this file. Presentation tokens
 * (`tone`, `icon`) are mapped to classes/components in
 * components/tracker/crimeTone.ts.
 */

export const CRIME_KINDS = {
  METHOD: "method",
  SCENARIO: "scenario",
  NONE: "none",
} as const;

export type CrimeKind = (typeof CRIME_KINDS)[keyof typeof CRIME_KINDS];

export type CrimeTone =
  | "crimson"
  | "orange"
  | "amber"
  | "yellow"
  | "lime"
  | "emerald"
  | "teal"
  | "cyan"
  | "sky"
  | "indigo"
  | "violet"
  | "fuchsia"
  | "rose"
  | "slate"
  | "zinc";

export type CrimeIconName =
  | "Sword"
  | "Hammer"
  | "Cable"
  | "FlaskConical"
  | "Crosshair"
  | "Bomb"
  | "Flame"
  | "Waves"
  | "ArrowDown"
  | "Zap"
  | "Wind"
  | "Lock"
  | "Theater"
  | "Skull"
  | "UserX"
  | "Gem"
  | "Coffee";

export type CrimeCategory = {
  /** Stable identifier persisted in the database. Never rename casually. */
  slug: string;
  label: string;
  kind: CrimeKind;
  icon: CrimeIconName;
  tone: CrimeTone;
  /** Always-available curated copy. Rendered even when enrichment fails. */
  description: string;
  /** Candidate Detective Conan World page titles for MediaWiki extracts. */
  wikiTitles: readonly string[];
  /** Candidate English Wikipedia titles, tried after DCW. */
  wikipediaTitles: readonly string[];
  /** Extra search terms so free-text search can hit the category. */
  aliases: readonly string[];
};

export const CRIME_CATEGORIES = [
  {
    slug: "stabbing",
    label: "Stabbing",
    kind: CRIME_KINDS.METHOD,
    icon: "Sword",
    tone: "crimson",
    description:
      "The single most common method in the series: a knife, letter opener, ice pick or shard of glass. Cases usually turn on the wound angle, the culprit's dominant hand, or a weapon that was never where it appeared to be.",
    wikiTitles: ["Category:Stabbing", "Stabbing"],
    wikipediaTitles: ["Stabbing"],
    aliases: ["knife", "blade", "stab"],
  },
  {
    slug: "blunt-force",
    label: "Blunt Force",
    kind: CRIME_KINDS.METHOD,
    icon: "Hammer",
    tone: "orange",
    description:
      "Death by impact — a trophy, ashtray, wrench, or an improvised weapon of opportunity. Frequently paired with a disposal trick, since the murder weapon is bulky and hard to hide.",
    wikiTitles: ["Category:Blunt Trauma", "Blunt trauma"],
    wikipediaTitles: ["Blunt trauma"],
    aliases: ["bludgeoning", "blunt trauma", "beaten"],
  },
  {
    slug: "strangulation",
    label: "Strangulation",
    kind: CRIME_KINDS.METHOD,
    icon: "Cable",
    tone: "violet",
    description:
      "Rope, wire, necktie or bare hands. These cases hinge on ligature marks and on physical plausibility — height, strength and reach routinely eliminate half the suspect list.",
    wikiTitles: ["Category:Strangling", "Strangling"],
    wikipediaTitles: ["Strangling"],
    aliases: ["strangling", "hanging", "ligature"],
  },
  {
    slug: "poisoning",
    label: "Poisoning",
    kind: CRIME_KINDS.METHOD,
    icon: "FlaskConical",
    tone: "lime",
    description:
      "Cyanide in a drink, a doctored capsule, a swapped glass. The classic puzzle is not what the poison was but how it reached only one person at a shared table.",
    wikiTitles: ["Category:Poison", "Poison"],
    wikipediaTitles: ["Poison", "Potassium cyanide"],
    aliases: ["poison", "cyanide", "drugged", "toxin"],
  },
  {
    slug: "shooting",
    label: "Shooting",
    kind: CRIME_KINDS.METHOD,
    icon: "Crosshair",
    tone: "slate",
    description:
      "Handguns and rifles, rarer in domestic cases and strongly associated with professionals and the Black Organization. Ballistics, gunpowder residue and the missing casing carry the deduction.",
    wikiTitles: ["Category:Shooting", "Shooting"],
    wikipediaTitles: ["Shooting"],
    aliases: ["gun", "firearm", "sniper", "gunshot"],
  },
  {
    slug: "explosion",
    label: "Bombing",
    kind: CRIME_KINDS.METHOD,
    icon: "Bomb",
    tone: "amber",
    description:
      "Timed devices, rigged gas lines and remote detonators. Often a countdown episode rather than a whodunit, and the signature of recurring bomber antagonists.",
    wikiTitles: ["Category:Bombing", "Bomb"],
    wikipediaTitles: ["Bomb", "Improvised explosive device"],
    aliases: ["bomb", "explosive", "detonator", "blast"],
  },
  {
    slug: "arson",
    label: "Arson",
    kind: CRIME_KINDS.METHOD,
    icon: "Flame",
    tone: "rose",
    description:
      "Fire used to kill or, more often, to destroy evidence of an earlier crime. The investigation usually reverses direction: establish what the fire was meant to erase.",
    wikiTitles: ["Category:Arson", "Arson"],
    wikipediaTitles: ["Arson"],
    aliases: ["fire", "burning", "incendiary"],
  },
  {
    slug: "drowning",
    label: "Drowning",
    kind: CRIME_KINDS.METHOD,
    icon: "Waves",
    tone: "sky",
    description:
      "Bathtubs, pools, harbours and lakes. Water destroys timing evidence, which makes the culprit's alibi window the real battleground.",
    wikiTitles: ["Category:Drowning", "Drowning"],
    wikipediaTitles: ["Drowning"],
    aliases: ["drowned", "water", "bathtub"],
  },
  {
    slug: "fall",
    label: "Fall from Height",
    kind: CRIME_KINDS.METHOD,
    icon: "ArrowDown",
    tone: "cyan",
    description:
      "Pushed from a rooftop, balcony or cliff — and almost always dressed up as suicide or a misstep. The tell is the landing position relative to the launch point.",
    wikiTitles: ["Category:Falling", "Falling"],
    wikipediaTitles: ["Defenestration", "Fall (accident)"],
    aliases: ["pushed", "rooftop", "cliff", "defenestration"],
  },
  {
    slug: "electrocution",
    label: "Electrocution",
    kind: CRIME_KINDS.METHOD,
    icon: "Zap",
    tone: "yellow",
    description:
      "Rigged appliances, exposed wiring and water-plus-current traps. A favourite of remote-trigger tricks, since the culprit can be demonstrably elsewhere.",
    wikiTitles: ["Category:Electrocution", "Electrocution"],
    wikipediaTitles: ["Electrical injury"],
    aliases: ["electric", "electrical", "shock", "wiring"],
  },
  {
    slug: "suffocation",
    label: "Suffocation",
    kind: CRIME_KINDS.METHOD,
    icon: "Wind",
    tone: "teal",
    description:
      "Smothering, plastic bags, sealed rooms and gas. Overlaps heavily with staged accidents, because carbon monoxide and stove gas read as negligence at first glance.",
    wikiTitles: ["Category:Suffocation", "Asphyxiation"],
    wikipediaTitles: ["Asphyxia", "Carbon monoxide poisoning"],
    aliases: ["asphyxiation", "smothering", "gas", "carbon monoxide"],
  },
  {
    slug: "locked-room",
    label: "Locked Room",
    kind: CRIME_KINDS.SCENARIO,
    icon: "Lock",
    tone: "indigo",
    description:
      "The body is found in a space nobody could have entered or left. The method is secondary; the trick is the seal — string-and-latch rigs, ice, magnets, or a misread time of death.",
    wikiTitles: ["Category:Locked Room Murder", "Locked room"],
    wikipediaTitles: ["Locked-room mystery"],
    aliases: ["closed room", "impossible crime", "sealed room"],
  },
  {
    slug: "staged-accident",
    label: "Staged Accident",
    kind: CRIME_KINDS.SCENARIO,
    icon: "Theater",
    tone: "fuchsia",
    description:
      "A deliberate killing disguised as a fall, a fire, a car crash or a suicide. These cases begin with the police closing the file and Conan refusing to.",
    wikiTitles: [],
    wikipediaTitles: [],
    aliases: ["disguised", "faked suicide", "accident"],
  },
  {
    slug: "serial-murder",
    label: "Serial Murder",
    kind: CRIME_KINDS.SCENARIO,
    icon: "Skull",
    tone: "crimson",
    description:
      "Multiple victims linked by a pattern — a shared past, a nursery rhyme, or a countdown of symbols. Typically multi-part episodes with the highest body counts in the series.",
    wikiTitles: ["Category:Serial Murder Cases", "Serial Murder Cases"],
    wikipediaTitles: ["Serial killer"],
    aliases: ["serial killer", "multiple victims", "spree"],
  },
  {
    slug: "kidnapping",
    label: "Kidnapping",
    kind: CRIME_KINDS.SCENARIO,
    icon: "UserX",
    tone: "emerald",
    description:
      "Abduction and ransom, often with the Detective Boys as the ones taken. Race-against-the-clock structure: the deduction is about location, not identity.",
    wikiTitles: ["Category:Kidnapping", "Kidnapping"],
    wikipediaTitles: ["Kidnapping"],
    aliases: ["abduction", "ransom", "hostage"],
  },
  {
    slug: "theft-heist",
    label: "Theft & Heist",
    kind: CRIME_KINDS.SCENARIO,
    icon: "Gem",
    tone: "violet",
    description:
      "Jewels, art and artefacts. Nobody dies; the puzzle is prediction and prevention. Home turf for Kaitou Kid, whose heist notices are riddles in their own right.",
    wikiTitles: ["Kaitou Kid", "Category:Theft"],
    wikipediaTitles: ["Art theft"],
    aliases: ["kid", "kaitou kid", "robbery", "burglary", "heist"],
  },
  {
    slug: "no-crime",
    label: "No Crime",
    kind: CRIME_KINDS.NONE,
    icon: "Coffee",
    tone: "zinc",
    description:
      "Slice-of-life, comedy and character episodes with no crime to solve. Skippable on a plot-only rewatch, and often the best character work in the series.",
    wikiTitles: [],
    wikipediaTitles: [],
    aliases: ["filler", "slice of life", "comedy", "no case"],
  },
] as const satisfies readonly CrimeCategory[];

export type CrimeSlug = (typeof CRIME_CATEGORIES)[number]["slug"];

export const CRIME_CATEGORY_SLUGS: readonly CrimeSlug[] = CRIME_CATEGORIES.map(
  (category) => category.slug,
);

const CRIME_CATEGORY_MAP = new Map<string, CrimeCategory>(
  CRIME_CATEGORIES.map((category) => [category.slug, category]),
);

/** Presentation grouping for the category browser and the admin selector. */
export const CRIME_GROUPS: readonly {
  kind: CrimeKind;
  label: string;
  blurb: string;
  slugs: readonly CrimeSlug[];
}[] = [
  {
    kind: CRIME_KINDS.METHOD,
    label: "Method",
    blurb: "How the crime was carried out.",
    slugs: CRIME_CATEGORIES.filter((c) => c.kind === CRIME_KINDS.METHOD).map(
      (c) => c.slug,
    ),
  },
  {
    kind: CRIME_KINDS.SCENARIO,
    label: "Scenario",
    blurb: "The shape of the case, independent of method.",
    slugs: CRIME_CATEGORIES.filter((c) => c.kind === CRIME_KINDS.SCENARIO).map(
      (c) => c.slug,
    ),
  },
  {
    kind: CRIME_KINDS.NONE,
    label: "Other",
    blurb: "Entries without a case to solve.",
    slugs: CRIME_CATEGORIES.filter((c) => c.kind === CRIME_KINDS.NONE).map(
      (c) => c.slug,
    ),
  },
];

export const CRIME_FILTER_ALL = "all" as const;

export type CrimeFilter = typeof CRIME_FILTER_ALL | CrimeSlug;

export function isCrimeSlug(value: unknown): value is CrimeSlug {
  return typeof value === "string" && CRIME_CATEGORY_MAP.has(value);
}

export function getCrimeCategory(slug: string): CrimeCategory | undefined {
  return CRIME_CATEGORY_MAP.get(slug);
}

/** Drops unknown slugs and de-duplicates, then restores taxonomy order. */
export function normalizeCrimeSlugs(
  value: readonly string[] | null | undefined,
): CrimeSlug[] {
  if (!value?.length) return [];
  const seen = new Set<CrimeSlug>();
  for (const slug of value) {
    if (isCrimeSlug(slug)) seen.add(slug);
  }
  return CRIME_CATEGORY_SLUGS.filter((slug) => seen.has(slug));
}

export function getCrimeCategories(
  value: readonly string[] | null | undefined,
): CrimeCategory[] {
  return normalizeCrimeSlugs(value)
    .map((slug) => CRIME_CATEGORY_MAP.get(slug))
    .filter((category): category is CrimeCategory => Boolean(category));
}

export function parseCrimeFilter(value: string | null | undefined): CrimeFilter {
  return isCrimeSlug(value) ? value : CRIME_FILTER_ALL;
}

export function matchesCrimeFilter(
  crimeTypes: readonly string[] | null | undefined,
  filter: CrimeFilter,
): boolean {
  if (filter === CRIME_FILTER_ALL) return true;
  return Boolean(crimeTypes?.includes(filter));
}

/** Counts entries per slug. Every known slug is present, defaulting to 0. */
export function countCrimes(
  entries: readonly { crime_types?: readonly string[] | null }[],
): Record<CrimeSlug, number> {
  const counts = Object.fromEntries(
    CRIME_CATEGORY_SLUGS.map((slug) => [slug, 0]),
  ) as Record<CrimeSlug, number>;

  for (const entry of entries) {
    for (const slug of normalizeCrimeSlugs(entry.crime_types)) {
      counts[slug] += 1;
    }
  }
  return counts;
}

export function formatCrimeLabels(
  value: readonly string[] | null | undefined,
): string {
  const labels = getCrimeCategories(value).map((category) => category.label);
  return labels.length ? labels.join(", ") : "Uncategorized";
}

/** Free-text match against label + aliases, for the tracker search box. */
export function crimeSearchTokens(
  value: readonly string[] | null | undefined,
): string {
  return getCrimeCategories(value)
    .flatMap((category) => [category.label, ...category.aliases])
    .join(" ")
    .toLowerCase();
}
