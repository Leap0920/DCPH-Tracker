/**
 * The "What's new" release notice.
 *
 * Shown to visitors on every open of the site — the appearance rules live in
 * components/whats-new/WhatsNewNotice.tsx. Everything a non-engineer might
 * want to edit (the wording, the version label) lives here.
 */

/** Label shown on the notice (also handy for support: "which update is this?"). */
export const WHATS_NEW_VERSION = "2026-10-01"

export type WhatsNewIcon = "download" | "flame" | "web" | "ranks" | "player" | "speed" | "palette"

export type WhatsNewEntry = {
  /** Keyed to an icon in components/whats-new/WhatsNewNotice.tsx. */
  icon: WhatsNewIcon
  title: string
  body: string
}

/** The user-facing changelog. Plain-spoken and short — this is read on phones. */
export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = [
  {
    icon: "flame",
    title: "Daily streaks are here",
    body: "Watch something every day to build your streak. Miss a day and it breaks — revive it up to 3 times a month, right from your tracker.",
  },
  {
    icon: "download",
    title: "Add DCPH to your home screen",
    body: "Open the menu and tap Add to home screen — DCPH installs in one tap and opens like a real app from its own icon. No app store needed.",
  },
  {
    icon: "web",
    title: "Characters & Red Strings",
    body: "The whole cast as one red-string web — flat, smooth and fast. Bigger dots mean more connections, names fade in as you zoom, and tapping a character opens their dossier.",
  },
  {
    icon: "ranks",
    title: "Tracker & rankings",
    body: "Ranks now show on every content type, the episode grid loads faster, and a batch of reported bugs is fixed.",
  },
  {
    icon: "player",
    title: "Carousel fixes",
    body: "Fullscreen behaves, the sound button no longer pauses the video, and tap-to-play works every time.",
  },
  {
    icon: "speed",
    title: "Lighter and faster",
    body: "A big performance pass — pages now download much less data, and videos no longer preload in the background. Kinder to your mobile data.",
  },
  {
    icon: "palette",
    title: "Fresh copy & phone polish",
    body: "Clearer wording across the site, plus phone-width fixes so rows no longer clip or overflow.",
  },
]

/**
 * The honest heads-up that rides along with this release. Once the image
 * situation clears, delete this block (and bump WHATS_NEW_VERSION).
 */
export const WHATS_NEW_ISSUE = {
  title: "Some images may not load right now",
  body: "All the new visitors pushed us past our image service's current limit, so a few portraits and pictures show up blank for now. Everything else works normally, and this fixes itself automatically. Thanks for the patience!",
}

export const WHATS_NEW_TITLE = "What's new"

export const WHATS_NEW_DESCRIPTION =
  "Recently shipped — plus one quick heads-up."
