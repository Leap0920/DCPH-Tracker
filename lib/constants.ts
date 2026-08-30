/** Content type discriminators */
export const CONTENT_TYPES = {
  EPISODE: "episode",
  MOVIE: "movie",
  SPECIAL: "special",
  OVA: "ova",
  LIVE_ACTION: "live_action",
  MAGIC_KAITO: "magic_kaito",
  HANZAWA: "hanzawa",
  ZERO_TEA_TIME: "zero_tea_time",
  YAIBA: "yaiba",
} as const;

export type ContentType = (typeof CONTENT_TYPES)[keyof typeof CONTENT_TYPES];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  episode: "Episode",
  movie: "Movie",
  special: "Special",
  ova: "OVA",
  live_action: "Live Action",
  magic_kaito: "Magic Kaito",
  hanzawa: "The Culprit Hanzawa",
  zero_tea_time: "Zero's Tea Time",
  yaiba: "Yaiba",
};

/** Glyph used next to each content type in the tracker UI */
export const CONTENT_TYPE_ICONS: Record<ContentType, string> = {
  episode: "📕",
  movie: "📘",
  special: "🔖",
  ova: "📓",
  live_action: "📚",
  magic_kaito: "🎩",
  hanzawa: "⚫",
  zero_tea_time: "🥤",
  yaiba: "🗡️",
};

/** Tracker grouping modes */
export const VIEW_MODES = {
  YEAR: "year",
  CHRONOLOGICAL: "chronological",
  CANON: "canon",
  ORDER: "order",
} as const;

export type ViewMode = (typeof VIEW_MODES)[keyof typeof VIEW_MODES];

export const VIEW_MODE_OPTIONS = [
  { value: VIEW_MODES.YEAR, label: "By Year" },
  { value: VIEW_MODES.CHRONOLOGICAL, label: "Story Order" },
  { value: VIEW_MODES.CANON, label: "Canon Guide" },
  { value: VIEW_MODES.ORDER, label: "Full Watch Order" },
] as const;

/** Watch status values */
export const WATCH_STATUSES = {
  UNWATCHED: "unwatched",
  WATCHED: "watched",
  REWATCHED: "rewatched",
} as const;

export type WatchStatus = (typeof WATCH_STATUSES)[keyof typeof WATCH_STATUSES];

export const WATCH_STATUS_LABELS: Record<WatchStatus, string> = {
  unwatched: "Unwatched",
  watched: "Watched",
  rewatched: "Rewatched",
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
    { value: "live_action", label: "Live Action" },
    { value: "magic_kaito", label: "Magic Kaito" },
    { value: "hanzawa", label: "Hanzawa" },
    { value: "zero_tea_time", label: "Zero's Tea Time" },
    { value: "yaiba", label: "Yaiba" },
  ] as const,
  STATUS: [
    { value: "all", label: "All Status" },
    { value: "unwatched", label: "Unwatched" },
    { value: "watched", label: "Watched" },
    { value: "rewatched", label: "Rewatched" },
  ] as const,
};

/** Navigation routes */
export const NAV_ROUTES = [
  { href: "/", label: "Home" },
  { href: "/tracker", label: "Tracker" },
  { href: "/arcs", label: "Story Arcs" },
  { href: "/characters", label: "Characters" },
  { href: "/analytics", label: "Self Analytics" },
  { href: "/wrapped", label: "Wrapped" },
  { href: "/community/rankings", label: "Rankings" },
  { href: "/community/chat", label: "Chat" },
] as const;

export interface NavSubItem {
  href: string;
  label: string;
  description: string;
  icon?: string;
}

export const NAV_MAIN = [
  { href: "/", label: "Home" },
  { href: "/tracker", label: "Tracker" },
] as const;

export const NAV_EXPLORE: NavSubItem[] = [
  { href: "/arcs", label: "Story Arcs", description: "Watch guide & arc breakdown", icon: "BookOpen" },
  { href: "/cases", label: "Case Files", description: "Every crime catalogued — types, victims & methods", icon: "FileText" },
  { href: "/characters", label: "Characters", description: "Character profiles & relationships", icon: "Users" },
  { href: "/analytics", label: "Self Analytics", description: "Personal stats & viewing insights", icon: "BarChart3" },
  { href: "/wrapped", label: "Wrapped", description: "Your watch stats as a shareable card", icon: "BarChart3" },
];

export const NAV_COMMUNITY: NavSubItem[] = [
  { href: "/community/rankings", label: "Rankings", description: "Detective leaderboards & badges", icon: "Trophy" },
  { href: "/community/chat", label: "Chat", description: "Live detective chat room", icon: "MessageSquare" },
];

/** Avatar placeholder URL pattern (UI Avatars service) */
export function avatarUrl(name: string): string {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=7A1620&color=E9E4D8&bold=true&size=128`;
}
