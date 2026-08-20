/**
 * Spoiler gating for the Characters & Red Strings graph.
 *
 * Pure logic: no React, no Supabase, no data imports. Everything here is a
 * function of (character/relationship metadata, the viewer's watch progress,
 * viewer options) -> a visibility tier. This is deliberately dependency-free so
 * it can be unit tested and reused by both the server and the client.
 *
 * Three tiers exist:
 *   - "visible"    render normally
 *   - "silhouette" render as an anonymous locked placeholder ("???")
 *   - "hidden"     do not render at all (the existence of the node is itself
 *                  the spoiler)
 */

/** How much of a spoiler a character or thread is. Controls treatment, not math. */
export type SpoilerLevel = "none" | "reveal" | "major"

/** Render tier produced by the gating functions. */
export type Visibility = "visible" | "silhouette" | "hidden"

/**
 * A first appearance (or a reveal). `episode` is the anime TV episode number,
 * `movie` the theatrical film number. `volume` is manga reference only and is
 * never used for gating — the tracker gates on anime progress.
 */
export interface Debut {
  episode?: number
  movie?: number
  volume?: number
  /** Optional pre-rendered label, e.g. "Ep. 129" or "Movie 1". */
  label?: string
}

/**
 * Per-character (or per-relationship) gating metadata, stored separately from
 * the character data itself so data entry is one flat, reviewable block.
 */
export interface SpoilerMeta {
  /** First appearance. Gates whether the node exists for the viewer at all. */
  debut?: Debut
  /**
   * Identity / true-nature reveal, when it is later than the debut. Gates
   * aliases and the spoiler half of the bio.
   */
  reveal?: Debut
  /** Treatment tier. Defaults to "none". */
  spoiler?: SpoilerLevel
  /** Shown on the locked card in place of the bio. Must not itself spoil. */
  lockedHint?: string
}

/** The viewer's anime progress, derived from the tracker. */
export interface WatchProgress {
  isSignedIn: boolean
  /** Episode numbers marked watched or rewatched. */
  episodes: Set<number>
  /** Movie numbers marked watched or rewatched. */
  movies: Set<number>
  /** Highest watched episode number, or 0 when none. */
  highestEpisode: number
}

/**
 * Gating strategy.
 *
 * - "progress" (default): a debut is reached when the viewer's highest watched
 *   episode is at or past it. Robust to gaps and to skipped filler, and it
 *   matches how people actually use a tracker.
 * - "strict": the exact debut episode must be marked watched. Truer to the
 *   literal request, but a viewer at episode 400 who never ticked 129 still
 *   sees Ai Haibara as locked, which reads as a bug.
 */
export type GateMode = "progress" | "strict"

export interface GateOptions {
  mode?: GateMode
  /** Explicit opt-in from the viewer to ignore all gating. */
  showEverything?: boolean
}

export const SPOILER_STORAGE_KEY = "dcph:characters:spoiler-mode"

/** Empty progress: signed out, nothing watched. */
export const EMPTY_PROGRESS: WatchProgress = {
  isSignedIn: false,
  episodes: new Set<number>(),
  movies: new Set<number>(),
  highestEpisode: 0,
}

/**
 * Build a WatchProgress from the plain arrays handed down by the server
 * component. Arrays (not Sets) cross the RSC boundary; rehydrate here.
 */
export function buildWatchProgress(input: {
  isSignedIn: boolean
  watchedEpisodes?: readonly number[] | null
  watchedMovies?: readonly number[] | null
}): WatchProgress {
  const episodes = new Set<number>()
  let highestEpisode = 0

  for (const raw of input.watchedEpisodes ?? []) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue
    episodes.add(raw)
    if (raw > highestEpisode) highestEpisode = raw
  }

  const movies = new Set<number>()
  for (const raw of input.watchedMovies ?? []) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue
    movies.add(raw)
  }

  return { isSignedIn: Boolean(input.isSignedIn), episodes, movies, highestEpisode }
}

/** True when the viewer's progress has reached the given debut. */
export function hasReached(
  debut: Debut | undefined,
  progress: WatchProgress,
  mode: GateMode = "progress",
): boolean {
  // No gating data means "not a spoiler" — fail open, so incomplete data never
  // silently erases half the cast.
  if (!debut) return true
  if (debut.episode == null && debut.movie == null) return true

  if (debut.episode != null) {
    if (mode === "strict") {
      if (progress.episodes.has(debut.episode)) return true
    } else if (progress.highestEpisode >= debut.episode) {
      return true
    }
  }

  // Movie debuts are always exact — there is no "up to movie N" ordering that
  // maps cleanly onto episode progress.
  if (debut.movie != null && progress.movies.has(debut.movie)) return true

  return false
}

/** Human label for a gate, e.g. "Episode 129", "Movie 1". */
export function unlockLabel(debut: Debut | undefined): string | null {
  if (!debut) return null
  if (debut.label) return debut.label
  if (debut.episode != null) return `Episode ${debut.episode}`
  if (debut.movie != null) return `Movie ${debut.movie}`
  return null
}

/** Short "how to unlock" sentence for the locked card and tooltips. */
export function unlockInstruction(
  meta: SpoilerMeta | undefined,
  progress: WatchProgress,
): string {
  const label = unlockLabel(meta?.debut)
  if (!progress.isSignedIn) {
    return label
      ? `Sign in and mark ${label} as watched to reveal this character.`
      : "Sign in and track your progress to reveal this character."
  }
  if (!label) return "Keep watching to reveal this character."
  return `Mark ${label} as watched to reveal this character.`
}

/**
 * Visibility of a single character.
 *
 * Signed-out viewers are treated as "progress unknown" rather than "progress
 * zero": the plain cast is shown, reveals are silhouetted, and major spoilers
 * are removed. Gating an anonymous visitor down to episode 1 produces an empty
 * graph that reads as broken rather than as careful.
 */
export function characterVisibility(
  meta: SpoilerMeta | undefined,
  progress: WatchProgress,
  options: GateOptions = {},
): Visibility {
  if (options.showEverything) return "visible"

  const level: SpoilerLevel = meta?.spoiler ?? "none"
  // Majors with no confirmed gate stay hidden — uncertainty resolves toward
  // hiding for major reveals.
  const hasGate = meta?.debut?.episode != null || meta?.debut?.movie != null
  if (level === "major" && !hasGate) return "hidden"

  if (!progress.isSignedIn) {
    if (level === "major") return "hidden"
    if (level === "reveal") return "silhouette"
    return "visible"
  }

  if (hasReached(meta?.debut, progress, options.mode)) return "visible"
  return level === "major" ? "hidden" : "silhouette"
}

/**
 * Whether the alias / codename sub-labels and the spoiler half of the bio may
 * be shown. A character can be visible while their identity is still secret.
 */
export function canRevealIdentity(
  meta: SpoilerMeta | undefined,
  progress: WatchProgress,
  options: GateOptions = {},
): boolean {
  if (options.showEverything) return true
  if (!meta?.reveal) {
    // No separate reveal beat: identity is public from the debut.
    return characterVisibility(meta, progress, options) === "visible"
  }
  if (!progress.isSignedIn) return false
  return hasReached(meta.reveal, progress, options.mode)
}

/**
 * Visibility of a red string. An edge is only as visible as its weakest
 * endpoint, and it carries its own gate on top — "same person" between two
 * individually-legitimate nodes is itself the reveal.
 */
export function relationshipVisibility(
  meta: SpoilerMeta | undefined,
  sourceVisibility: Visibility,
  targetVisibility: Visibility,
  progress: WatchProgress,
  options: GateOptions = {},
): Visibility {
  if (options.showEverything) return "visible"

  if (sourceVisibility === "hidden" || targetVisibility === "hidden") return "hidden"

  const level: SpoilerLevel = meta?.spoiler ?? "none"
  const gate = meta?.reveal ?? meta?.debut
  const reached = progress.isSignedIn
    ? hasReached(gate, progress, options.mode)
    : level === "none"

  if (!reached) {
    // A major thread must not even hint at its own shape.
    return level === "major" ? "hidden" : "silhouette"
  }

  if (sourceVisibility === "silhouette" || targetVisibility === "silhouette") {
    return "silhouette"
  }

  return "visible"
}

export interface GraphVisibility<TId extends string = string> {
  characters: Map<TId, Visibility>
  relationships: Map<string, Visibility>
  /** Counts for the progress banner. */
  stats: {
    total: number
    visible: number
    silhouette: number
    hidden: number
  }
}

/**
 * One-shot pass over the whole cast. Call this once per render (memoised) and
 * read the maps everywhere else, so node and edge decisions can never disagree.
 */
export function computeGraphVisibility<
  TChar extends { id: string },
  TRel extends { id: string; source: string; target: string },
>(
  characters: readonly TChar[],
  relationships: readonly TRel[],
  metaFor: (id: string) => SpoilerMeta | undefined,
  progress: WatchProgress,
  options: GateOptions = {},
): GraphVisibility {
  const characterMap = new Map<string, Visibility>()
  const stats = { total: 0, visible: 0, silhouette: 0, hidden: 0 }

  for (const character of characters) {
    const visibility = characterVisibility(metaFor(character.id), progress, options)
    characterMap.set(character.id, visibility)
    stats.total += 1
    stats[visibility] += 1
  }

  const relationshipMap = new Map<string, Visibility>()
  for (const relationship of relationships) {
    const sourceVisibility = characterMap.get(relationship.source) ?? "hidden"
    const targetVisibility = characterMap.get(relationship.target) ?? "hidden"
    relationshipMap.set(
      relationship.id,
      relationshipVisibility(
        metaFor(relationship.id),
        sourceVisibility,
        targetVisibility,
        progress,
        options,
      ),
    )
  }

  return { characters: characterMap, relationships: relationshipMap, stats }
}

/** Display name honouring the gate. Use everywhere a name is rendered. */
export function displayName(
  name: string,
  visibility: Visibility,
  placeholder = "???",
): string {
  return visibility === "visible" ? name : placeholder
}
