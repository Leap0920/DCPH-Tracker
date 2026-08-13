// Canonical movie guide for the DCPH tracker.
// Mainline films 1-29 follow the official Detective Conan movie numbering.
// Sources:
//   - 1-27: user-provided canonical table (English / Japanese romaji / release year)
//   - 28: One-eyed Flashback (theatrical release April 2025) - already released
//   - 29: Fallen Angel of the Highway (theatrical release April 2026) - upcoming
// Non-mainline slugs reference content_entries rows that exist in the DB.

export interface MainlineMovie {
  /** Canonical film number (1–29). */
  number: number;
  /** English release title. */
  english: string;
  /** Japanese title in romaji. */
  japanese: string;
  /** Theatrical release year (2020 gap — no mainline film that year). */
  year: number;
}

export const MAINLINE_MOVIES: MainlineMovie[] = [
  { number: 1, english: "The Time-Bombed Skyscraper", japanese: "Tokei-jikake no Matenrō", year: 1997 },
  { number: 2, english: "The Fourteenth Target", japanese: "Jūyon-banme no Tāgetto", year: 1998 },
  { number: 3, english: "The Last Wizard of the Century", japanese: "Seikimatsu no Majutsushi", year: 1999 },
  { number: 4, english: "Captured in Her Eyes", japanese: "Hitomi no Naka no Ansatsusha", year: 2000 },
  { number: 5, english: "Countdown to Heaven", japanese: "Tengoku e no Kauntodaun", year: 2001 },
  { number: 6, english: "The Phantom of Baker Street", japanese: "Beikā Sutorīto no Bōrei", year: 2002 },
  { number: 7, english: "Crossroad in the Ancient Capital", japanese: "Meikyū no Jūjiro", year: 2003 },
  { number: 8, english: "Magician of the Silver Sky", japanese: "Gin'yoku no Majishan", year: 2004 },
  { number: 9, english: "Strategy Above the Depths", japanese: "Suihei Senjō no Sutoratejī", year: 2005 },
  { number: 10, english: "The Private Eyes' Requiem", japanese: "Tantei-tachi no Rekuiemu", year: 2006 },
  { number: 11, english: "Jolly Roger in the Deep Azure", japanese: "Konpeki no Jorī Rojā", year: 2007 },
  { number: 12, english: "Full Score of Fear", japanese: "Senritsu no Furu Sukoa", year: 2008 },
  { number: 13, english: "The Raven Chaser", japanese: "Shikkoku no Cheisā", year: 2009 },
  { number: 14, english: "The Lost Ship in the Sky", japanese: "Tenkū no Rosuto Shippu", year: 2010 },
  { number: 15, english: "Quarter of Silence", japanese: "Chinmoku no Kwōtā", year: 2011 },
  { number: 16, english: "The Eleventh Striker", japanese: "Jūichi-ninme no Sutoraikā", year: 2012 },
  { number: 17, english: "Private Eye in the Distant Sea", japanese: "Zekkai no Puraibēto Ai", year: 2013 },
  { number: 18, english: "Dimensional Sniper", japanese: "Ijigen no Sunaipā", year: 2014 },
  { number: 19, english: "Sunflowers of Inferno", japanese: "Gōka no Himawari", year: 2015 },
  { number: 20, english: "The Darkest Nightmare", japanese: "Junkoku no Naitomea", year: 2016 },
  { number: 21, english: "The Crimson Love Letter", japanese: "Karakurenai no Raburetā", year: 2017 },
  { number: 22, english: "Zero the Enforcer", japanese: "Zero no Shikkounin", year: 2018 },
  { number: 23, english: "The Fist of Blue Sapphire", japanese: "Konjō no Fisuto", year: 2019 },
  { number: 24, english: "The Scarlet Bullet", japanese: "Hiiro no Dangan", year: 2021 },
  { number: 25, english: "The Bride of Halloween", japanese: "Harowin no Hanayome", year: 2022 },
  { number: 26, english: "Black Iron Submarine", japanese: "Kurogane no Submarine", year: 2023 },
  { number: 27, english: "The Million-dollar Pentagram", japanese: "Hyakuman Doru no Michishirube", year: 2024 },
  { number: 28, english: "One-eyed Flashback", japanese: "Dokugan no Furasshubakku", year: 2025 },
  { number: 29, english: "Fallen Angel of the Highway", japanese: "Haiwei no Tenshi", year: 2026 },
];

/** Slugs of content_entries rows that belong in the "Other movies" box. */
export const OTHER_MOVIE_SLUGS = [
  "mov-19", // Detective Conan: Conan vs. Kid - Shark & Jewel (2005 TV special)
  "mov-22", // Detective Conan: Conan vs. Kid - Jet Black Sniper (2006 TV special)
  "mov-33", // Detective Conan: The Magician of Starlight (2012 TV special)
  "mov-37", // Lupin III vs. Detective Conan: The Movie (2013 crossover)
  "mov-41", // Detective Conan Manner Movie (2015 theater etiquette short)
  "mov-46", // Detective Conan: The Scarlet Alibi (2021 TV special)
] as const;

/** True when a content_entries row (matched by slug) belongs to the "Other movies" box. */
export function isOtherMovie(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return (OTHER_MOVIE_SLUGS as readonly string[]).includes(slug);
}
