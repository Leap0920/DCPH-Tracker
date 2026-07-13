/** Content type discriminators */
export const CONTENT_TYPES = {
  EPISODE: "episode",
  MOVIE: "movie",
  SPECIAL: "special",
  OVA: "ova",
} as const;

export type ContentType = (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  episode: "Episode",
  movie: "Movie",
  special: "Special",
  ova: "OVA",
};

/** Watch status values */
export const WATCH_STATUSES = {
  UNWATCHED: "unwatched",
  WATCHING: "watching",
  WATCHED: "watched",
} as const;

export type WatchStatus = (typeof WATCH_STATUSES)[keyof typeof WATCH_STATUSES];

export const WATCH_STATUS_LABELS: Record<WatchStatus, string> = {
  unwatched: "Unwatched",
  watching: "Watching",
  watched: "Watched",
};

/** Filter chip options for the tracker */
export const FILTER_OPTIONS = {
  SORT_BY: [
    { value: "air_date", label: "By Air Date" },
    { value: "canon_order", label: "By Story Order" },
  ] as const,
  TYPE: [
    { value: "all", label: "All Types" },
    { value: "episode", label: "Episodes" },
    { value: "movie", label: "Movies" },
    { value: "special", label: "Specials" },
    { value: "ova", label: "OVAs" },
  ] as const,
  STATUS: [
    { value: "all", label: "All Status" },
    { value: "unwatched", label: "Unwatched" },
    { value: "watching", label: "Watching" },
    { value: "watched", label: "Watched" },
  ] as const,
};

/** Navigation routes */
export const NAV_ROUTES = [
  { href: "/", label: "Home" },
  { href: "/tracker", label: "Tracker" },
  { href: "/arcs", label: "Story Arcs" },
  { href: "/community/rankings", label: "Rankings" },
  { href: "/community/chat/general", label: "Chat" },
] as const;

/** Avatar placeholder URL pattern (UI Avatars service) */
export function avatarUrl(name: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=7A1620&color=E9E4D8&bold=true&size=128`;
}
