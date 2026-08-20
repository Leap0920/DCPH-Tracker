/**
 * Characters & Red Strings data
 *
 * A curated, self-contained guide to the cast of Detective Conan and the
 * "red strings" — the relationships that bind them. Characters are placed on
 * a fixed coordinate canvas (x, y) for the hand-rolled SVG graph, and
 * relationships are typed edges between them. Alias identities are a single
 * node (Conan Edogawa / Shinichi Kudo share one node), and multi-type pairs
 * render as parallel offset strings.
 *
 * Sources: Case Closed / Detective Conan Wiki character and relationship canon.
 */

export type RelationshipType =
  | "romance"
  | "family"
  | "friendship"
  | "rivalry"
  | "mentor"
  | "colleague"
  | "secret_identity"
  | "adversary"

export interface Character {
  id: string
  name: string
  /** Known aliases / codenames, shown as sub-labels on the node */
  aliases?: string[]
  role: string
  affiliation: string
  bio: string
  /** Fixed canvas position for the SVG graph */
  x?: number
  y?: number
}

export interface Relationship {
  id: string
  source: string
  target: string
  type: RelationshipType
  detail: string
}

export const RELATIONSHIP_META: Record<
  RelationshipType,
  { label: string; color: string; description: string }
> = {
  romance: {
    label: "Romance",
    color: "#DC2626",
    description: "Romantic love or a love-adjacent bond",
  },
  family: {
    label: "Family",
    color: "#D97706",
    description: "Blood relation or an adopted family tie",
  },
  friendship: {
    label: "Friendship",
    color: "#3B82F6",
    description: "A close bond of trust and mutual support",
  },
  rivalry: {
    label: "Rivalry",
    color: "#7C3AED",
    description: "Competing for the same prize or the same crown",
  },
  mentor: {
    label: "Mentor",
    color: "#059669",
    description: "One side guides and shapes the other",
  },
  colleague: {
    label: "Colleague",
    color: "#64748B",
    description: "A working partnership in the same line of duty",
  },
  secret_identity: {
    label: "Secret Identity / Alias",
    color: "#DB2777",
    description: "An alias, disguise, or hidden identity shared between two",
  },
  adversary: {
    label: "Adversary",
    color: "#0F172A",
    description: "Enemies on opposite sides of the case",
  },
}

/** Curated cast (62 nodes) on a 2000x1400 canvas. */
export const CHARACTERS: Character[] = [
  // ─── Kudo Family (top-left) ────────────────────────────────────────
  {
    id: "conan-edogawa",
    name: "Conan Edogawa / Shinichi Kudo",
    aliases: ["Shinichi Kudo"],
    role: "The shrunken detective of Beika",
    affiliation: "Junior Detective League",
    bio: "High-school sleuth Shinichi Kudo, poisoned by the Black Organization's APTX 4869, shrinks to a child and hides as Conan Edogawa. He lives beside Ran as a child, solving cases he can never claim credit for while hunting the men who shrank him.",
    x: 498,
    y: 428,
  },
  {
    id: "yusaku-kudo",
    name: "Yusaku Kudo",
    role: "World-renowned mystery novelist and Shinichi's father",
    affiliation: "Kudo Family",
    bio: "The legendary mystery author whose deductions dwarf even his son's. Yusaku is one of the few adults Conan openly trusts with the Organization secret.",
    x: 150,
    y: 100,
  },
  {
    id: "yukiko-kudo",
    name: "Yukiko Kudo",
    role: "Retired actress and Shinichi's mother",
    affiliation: "Kudo Family",
    bio: "Shinichi's glamorous mother, a retired Hollywood-style actress trained in disguise arts. Yukiko loves impersonation and, alongside her husband, anchors Conan's greatest allies.",
    x: 80,
    y: 160,
  },

  // ─── Osaka / Hattori (left side) ──────────────────────────────────
  {
    id: "heiji-hattori",
    name: "Heiji Hattori",
    role: "Osaka's great high-school detective",
    affiliation: "Osaka / Hattori Household",
    bio: "The brilliant, brash detective from Osaka who matches Shinichi deduction for deduction. Heiji knows Conan's secret, and their rivalry-turned-friendship anchors many cross-region cases.",
    x: 120,
    y: 300,
  },
  {
    id: "kazuha-toyama",
    name: "Kazuha Toyama",
    role: "Heiji's childhood friend and caring sparring partner",
    affiliation: "Osaka Cast",
    bio: "Heiji's childhood friend who secretly loves him and frequently saves him with her aikido. Kazuha is endlessly protective, jealous, and devoted, mirroring Ran's own long wait.",
    x: 80,
    y: 400,
  },
  {
    id: "heizo-hattori",
    name: "Heizo Hattori",
    role: "Osaka Superintendent, Heiji's father",
    affiliation: "Osaka Police",
    bio: "The Osaka police superintendent and Heiji's father, a formidable detective in his own right.",
    x: 50,
    y: 250,
  },
  {
    id: "ginshiro-toyama",
    name: "Ginshiro Toyama",
    role: "Osaka police chief, Kazuha's father",
    affiliation: "Osaka Police",
    bio: "The Osaka police chief and Kazuha's father, a close friend of Heizo Hattori.",
    x: 130,
    y: 450,
  },

  // ─── Mouri-Kisaki Family (left-center) ────────────────────────────
  {
    id: "kogoro-mouri",
    name: "Kogoro Mouri",
    role: "The 'Sleeping Kogoro' private detective",
    affiliation: "Mouri Detective Agency",
    bio: "Ran's hard-drinking, sharp-eyed father runs a private detective agency. Conan secretly solves many of his cases, knocking him out to deliver deductions through the 'Sleeping Kogoro' act.",
    x: 280,
    y: 440,
  },
  {
    id: "ran-mouri",
    name: "Ran Mouri",
    role: "Childhood friend, karate champion, unwitting guardian",
    affiliation: "Mouri Family",
    bio: "Ran is Shinichi's dearest childhood friend and the daughter of Kogoro and Eri. A national karate champion, she waits years for Shinichi's return, unaware the boy she shelters is him.",
    x: 320,
    y: 330,
  },
  {
    id: "eri-kisaki",
    name: "Eri Kisaki",
    role: "Formidable lawyer and Kogoro's estranged wife",
    affiliation: "Kisaki Law Offices",
    bio: "A brilliant lawyer, Ran's mother, and Kogoro's long-separated wife. Eri's courtroom mastery repeatedly overlaps with Conan's cases, and her love for Kogoro never truly faded.",
    x: 180,
    y: 480,
  },

  // ─── Conan Hub (center) ───────────────────────────────────────────
  {
    id: "ai-haibara",
    name: "Ai Haibara / Shiho Miyano",
    aliases: ["Shiho Miyano", "Sherry"],
    role: "Defector from the Black Organization, Conan's secret ally",
    affiliation: "Junior Detective League",
    bio: "Formerly the Organization's scientist Shiho Miyano, creator alongside her sister of APTX 4869. After escaping and shrinking, she lives with Agasa as Ai Haibara, Conan's only true peer on the secret.",
    x: 520,
    y: 230,
  },
  {
    id: "professor-agasa",
    name: "Professor Hiroshi Agasa",
    role: "Inventor of Conan's gadgets and the Detective Boys' mentor",
    affiliation: "Beika Inventor & Supporting Cast",
    bio: "A brilliant absent-minded inventor and family friend of the Kudus. Agasa builds Conan's gadgets, shelters Ai Haibara, and invents the tools that turn the tide of countless cases.",
    x: 470,
    y: 130,
  },

  // ─── Detective Boys (center-top) ──────────────────────────────────
  {
    id: "ayumi-yoshida",
    name: "Ayumi Yoshida",
    role: "Cheerful heart of the Detective Boys",
    affiliation: "Junior Detective League",
    bio: "The gentle, optimistic member of the Detective Boys who adores Conan. Ayumi brings warmth and intuition to the team's ad-hoc investigations around Beika.",
    x: 400,
    y: 60,
  },
  {
    id: "genta-kojima",
    name: "Genta Kojima",
    role: "Stout, hungry founding member of the Detective Boys",
    affiliation: "Junior Detective League",
    bio: "The self-appointed second-in-command of the Detective Boys, loyal and food-loving. Genta's uncanny memory and appetite often prove surprising assets in a pinch.",
    x: 470,
    y: 40,
  },
  {
    id: "mitsuhiko-tsuburaya",
    name: "Mitsuhiko Tsuburaya",
    role: "Bookish know-it-all of the Detective Boys",
    affiliation: "Junior Detective League",
    bio: "A studious, science-minded member of the Detective Boys who looks up to Conan. Mitsuhiko's textbook reasoning and gentle crush on Ayumi round out the trio.",
    x: 540,
    y: 60,
  },

  // ─── School / Ally Circle (center-right) ──────────────────────────
  {
    id: "sonoko-suzuki",
    name: "Sonoko Suzuki",
    role: "Ran's best friend and the Suzuki Group heiress",
    affiliation: "Suzuki Family",
    bio: "Ran's lively best friend and heiress of the colossal Suzuki Group. Often the damsel in a Kid heist, Sonoko fancies herself a trendsetter and an amateur detective.",
    x: 600,
    y: 200,
  },
  {
    id: "makoto-kyogoku",
    name: "Makoto Kyogoku",
    role: "Sonoko's karate-champion boyfriend",
    affiliation: "Suzuki Family / Martial Arts Cast",
    bio: "A quiet, gentle giant and national karate champion who once tied with Ran. Makoto is utterly devoted to Sonoko, proving his love by defending her through impossible odds.",
    x: 550,
    y: 280,
  },
  {
    id: "masumi-sera",
    name: "Masumi Sera",
    role: "Sharp-eyed detective convinced Conan is Shinichi",
    affiliation: "Teitan High School",
    bio: "A perceptive high-school detective, Akai's sister, and Mary's daughter, who guessed Conan's identity. Masumi's outsider cleverness keeps her perpetually circling the truth.",
    x: 660,
    y: 310,
  },

  // ─── Suzuki Family (right of Sonoko) ──────────────────────────────
  {
    id: "shiro-suzuki",
    name: "Shiro Suzuki",
    role: "Sonoko's father, CEO of the Suzuki Group",
    affiliation: "Suzuki Family",
    bio: "The patriarch of the Suzuki family and CEO of the massive Suzuki Group.",
    x: 780,
    y: 150,
  },
  {
    id: "tomoko-suzuki",
    name: "Tomoko Suzuki",
    role: "Sonoko's mother",
    affiliation: "Suzuki Family",
    bio: "Sonoko's mother, a sophisticated woman who indulges her daughters.",
    x: 720,
    y: 200,
  },
  {
    id: "ayako-suzuki",
    name: "Ayako Suzuki",
    role: "Sonoko's older sister",
    affiliation: "Suzuki Family",
    bio: "Sonoko's elegant older sister, married to Yuzo Tomizawa.",
    x: 840,
    y: 200,
  },
  {
    id: "yuzo-tomizawa",
    name: "Yuzo Tomizawa",
    role: "Ayako's husband, Sonoko's brother-in-law",
    affiliation: "Suzuki Family",
    bio: "The husband of Ayako Suzuki, a reliable and steady presence in the family.",
    x: 900,
    y: 250,
  },
  {
    id: "jirokichi-suzuki",
    name: "Jirokichi Suzuki",
    role: "Sonoko's great-uncle, eccentric billionaire who hunts Kaitou Kid",
    affiliation: "Suzuki Family",
    bio: "An eccentric billionaire who funds elaborate traps to catch Kaitou Kid, only to be outwitted every time.",
    x: 860,
    y: 290,
  },

  // ─── Kaito Kid / Magic Kaito (top-right) ─────────────────────────
  {
    id: "kaitou-kid",
    name: "Kaitou Kid / Kaito Kuroba",
    aliases: ["Kaito Kuroba"],
    role: "The gentleman phantom thief",
    affiliation: "Phantom Thief Kid",
    bio: "The theatrical phantom thief whose impossible heists are a recurring puzzle for Conan. Behind the showman is high-schooler Kaito Kuroba, seeking the truth of his father's death.",
    x: 900,
    y: 80,
  },
  {
    id: "aoko-nakamori",
    name: "Aoko Nakamori",
    role: "Kaito's classmate and love interest",
    affiliation: "Phantom Thief Cast",
    bio: "Kaito's childhood friend and love interest, unaware of his double life as Kaitou Kid.",
    x: 800,
    y: 90,
  },
  {
    id: "ginzo-nakamori",
    name: "Inspector Ginzo Nakamori",
    role: "The officer who swears he will catch Kaitou Kid",
    affiliation: "Tokyo Metropolitan Police",
    bio: "The explosive, prideful inspector of the division devoted to capturing Kaitou Kid. Nakamori loses heist after heist yet never stops swearing this time will be different.",
    x: 960,
    y: 130,
  },
  {
    id: "saguru-hakuba",
    name: "Saguru Hakuba",
    role: "Half-British detective who suspects Kaito is Kid",
    affiliation: "Phantom Thief Cast",
    bio: "A brilliant half-British detective who suspects Kaitou Kid's true identity and investigates him.",
    x: 1000,
    y: 80,
  },
  {
    id: "jii-konosuke",
    name: "Jii Konosuke",
    role: "Toichi's old assistant, now Kaito's aide",
    affiliation: "Phantom Thief Cast",
    bio: "Toichi Kuroba's old assistant, now Kaito's trusted aide and butler figure.",
    x: 1060,
    y: 190,
  },

  // ─── Tokyo MPD (bottom-center) ────────────────────────────────────
  {
    id: "inspector-megure",
    name: "Inspector Juzo Megure",
    role: "The veteran detective who works with 'Sleeping Kogoro'",
    affiliation: "Tokyo Metropolitan Police",
    bio: "The grizzled, pipe-smoking homicide inspector of the Tokyo MPD. Megure is a constant at Conan's crime scenes, trusting Kogoro's 'intuition' while the child detective works unseen.",
    x: 450,
    y: 580,
  },
  {
    id: "officer-sato",
    name: "Officer Miwako Sato",
    role: "The MPD's toughest, most capable detective",
    affiliation: "Tokyo Metropolitan Police",
    bio: "A fearless MPD detective and Takagi's longtime partner and object of his devotion. Sato's skill, cool head, and romantic history with Takagi anchor the Tokyo crime squad.",
    x: 500,
    y: 640,
  },
  {
    id: "officer-takagi",
    name: "Officer Wataru Takagi",
    role: "Sato's earnest, accident-prone partner",
    affiliation: "Tokyo Metropolitan Police",
    bio: "An earnest, well-meaning MPD detective perpetually in Sato's orbit. Takagi's clumsy heroics and steadfast loyalty make him both the squad comic and its romantic heart.",
    x: 420,
    y: 660,
  },
  {
    id: "ninzaburo-shiratori",
    name: "Ninzaburo Shiratori",
    role: "MPD detective with unrequited feelings for Sato",
    affiliation: "Tokyo Metropolitan Police",
    bio: "A refined MPD detective who harbors unrequited feelings for Officer Sato.",
    x: 580,
    y: 600,
  },
  {
    id: "kazunobu-chiba",
    name: "Kazunobu Chiba",
    role: "MPD detective married to Naeko Miike",
    affiliation: "Tokyo Metropolitan Police",
    bio: "A dedicated MPD detective who is married to fellow officer Naeko Miike.",
    x: 630,
    y: 660,
  },
  {
    id: "naeko-miike",
    name: "Naeko Miike",
    role: "MPD officer, Chiba's wife",
    affiliation: "Tokyo Metropolitan Police",
    bio: "An MPD officer and the wife of Detective Chiba.",
    x: 680,
    y: 630,
  },
  {
    id: "yumi-miyamoto",
    name: "Yumi Miyamoto",
    role: "MPD officer, part of the Tokyo squad",
    affiliation: "Tokyo Metropolitan Police",
    bio: "A capable MPD officer who is part of the core Tokyo squad.",
    x: 550,
    y: 700,
  },
  {
    id: "hyoue-kuroda",
    name: "Hyoue Kuroda",
    role: "Superintendent Supervisor, Rum-arc figure",
    affiliation: "Tokyo Metropolitan Police",
    bio: "A high-ranking police official whose past is shrouded in mystery, suspected of being the Black Organization's 'Rum'.",
    x: 400,
    y: 720,
  },
  {
    id: "shintaro-chaki",
    name: "Shintaro Chaki",
    role: "MPD criminal investigation superior overseeing Nakamori's Kid task force",
    affiliation: "Tokyo Metropolitan Police",
    bio: "A senior MPD official who oversees the task force dedicated to capturing Kaitou Kid.",
    x: 500,
    y: 720,
  },

  // ─── Regional Police (far left-bottom) ────────────────────────────
  {
    id: "kansuke-yamato",
    name: "Kansuke Yamato",
    role: "Nagano Prefecture inspector, cold demeanor, scarred eye",
    affiliation: "Nagano Police",
    bio: "A brilliant but cold Nagano inspector with a scarred eye, fiercely protective of his colleague Yui Uehara.",
    x: 80,
    y: 580,
  },
  {
    id: "yui-uehara",
    name: "Yui Uehara",
    role: "Nagano police, childhood friend of Yamato",
    affiliation: "Nagano Police",
    bio: "A kind Nagano officer and childhood friend of Kansuke Yamato, whose return from a supposed death deeply affected him.",
    x: 140,
    y: 620,
  },
  {
    id: "misao-yamamura",
    name: "Misao Yamamura",
    aliases: ["Detective Magnum"],
    role: "Gunma Prefecture inspector, comic-relief detective",
    affiliation: "Gunma Police",
    bio: "A bumbling but well-meaning Gunma inspector with aspirations of becoming a film director.",
    x: 60,
    y: 680,
  },
  {
    id: "sango-yokomizo",
    name: "Sango Yokomizo",
    role: "Shizuoka district inspector",
    affiliation: "Shizuoka Police",
    bio: "A Shizuoka inspector who is the twin brother of Jugo Yokomizo.",
    x: 200,
    y: 580,
  },
  {
    id: "jugo-yokomizo",
    name: "Jugo Yokomizo",
    role: "Sango's twin brother, Saitama police",
    affiliation: "Saitama Police",
    bio: "A Saitama police officer and the twin brother of Sango Yokomizo.",
    x: 200,
    y: 650,
  },

  // ─── Public Security Bureau (right side) ──────────────────────────
  {
    id: "tooru-amuro",
    name: "Tooru Amuro / Bourbon",
    aliases: ["Bourbon", "Rei Furuya"],
    role: "Triple agent: café waiter, detective, Organization operative",
    affiliation: "Public Security Bureau / Black Organization",
    bio: "A triple agent serving the Organization, the police, and the national security agencies at once. As café waiter 'Toru Amuro' and operative Bourbon, he guards a secret as layered as his code names.",
    x: 870,
    y: 400,
  },
  {
    id: "rumi-wakasa",
    name: "Rumi Wakasa",
    role: "One of the three narrowed 'Rum' suspects",
    affiliation: "Public Security Bureau",
    bio: "A mysterious woman suspected of being the Black Organization's 'Rum'.",
    x: 950,
    y: 420,
  },
  {
    id: "jinpei-matsuda",
    name: "Jinpei Matsuda",
    role: "Furuya's late mentor, deceased PSB agent",
    affiliation: "Public Security Bureau (deceased)",
    bio: "A deceased Public Security Bureau agent who was Tooru Amuro's mentor.",
    x: 830,
    y: 480,
  },
  {
    id: "hiromitsu-morofushi",
    name: "Hiromitsu Morofushi / Scotch",
    aliases: ["Scotch"],
    role: "Deceased PSB double agent, childhood friend of Yamamura",
    affiliation: "Public Security Bureau (deceased)",
    bio: "A deceased Public Security Bureau agent and childhood friend of Misao Yamamura, whose death is a source of great guilt for Tooru Amuro.",
    x: 920,
    y: 500,
  },

  // ─── FBI / CIA (right-center) ────────────────────────────────────
  {
    id: "shuichi-akai",
    name: "Shuichi Akai",
    aliases: ["Rye", "Subaru Okiya"],
    role: "FBI agent on the Organization's trail",
    affiliation: "FBI",
    bio: "A crack FBI marksman and the man who destroyed Gin's roadblock plan. Akai was once Bourbon's target of obsession and is the presumed-dead brother of Masumi and the lost love of Akemi.",
    x: 740,
    y: 460,
  },
  {
    id: "jodie-starling",
    name: "Jodie Starling",
    role: "FBI agent and survivor of a past Organization crime",
    affiliation: "FBI",
    bio: "An FBI agent of Japanese descent hunting the Organization that killed her father. Jodie once posed as an English teacher in Beika, crossing paths with the cast before her true role surfaced.",
    x: 680,
    y: 520,
  },
  {
    id: "james-black",
    name: "James Black",
    role: "Genial senior agent of the FBI",
    affiliation: "FBI",
    bio: "The calm, much-tested supervisor of the FBI's Japanese headquarters. James steadies the volatile Akai and Jodie while they close in on the Organization.",
    x: 620,
    y: 550,
  },
  {
    id: "mary-sera",
    name: "Mary Sera",
    role: "Shrunk British agent and the Sera matriarch",
    affiliation: "MI6 / Sera Family",
    bio: "The shrunk British intelligence agent who, like Conan and Haibara, was undone by APTX. Masumi's mother, she operates in secret as a mysterious child.",
    x: 760,
    y: 580,
  },
  {
    id: "shukichi-haneda",
    name: "Shukichi Haneda",
    role: "Tied to the Akai family and Rum investigation",
    affiliation: "FBI",
    bio: "A man with ties to both the Akai family and the investigation into the identity of 'Rum'.",
    x: 830,
    y: 560,
  },
  {
    id: "kir",
    name: "Kir / Rena Mizunashi",
    aliases: ["Rena Mizunashi"],
    role: "CIA mole inside the Black Organization",
    affiliation: "CIA / Black Organization",
    bio: "A CIA operative who has infiltrated the Black Organization, feeding intelligence to her handlers.",
    x: 780,
    y: 530,
  },

  // ─── Black Organization (far right) ──────────────────────────────
  {
    id: "renya-karasuma",
    name: "Renya Karasuma",
    role: "The Boss ('Him'), old acquaintance of Yusaku Kudo",
    affiliation: "Black Organization",
    bio: "The elusive and aging head of the Black Organization, an old acquaintance and rival of Yusaku Kudo.",
    x: 1250,
    y: 300,
  },
  {
    id: "gin",
    name: "Gin",
    role: "Ruthless senior operative of the Black Organization",
    affiliation: "Black Organization",
    bio: "The cold, bloodthirsty operative who shrank Shinichi and believes Sherry dead. Gin's paranoia and cruelty make him the series' most dangerous sleeper threat to Conan.",
    x: 1150,
    y: 350,
  },
  {
    id: "vodka",
    name: "Vodka",
    role: "Gin's loyal, blunt partner",
    affiliation: "Black Organization",
    bio: "Gin's driver and enforcer, competent but far less sharp than his senior. Vodka stood beside Gin the night Conan was poisoned, anchoring the pair to the series' origin.",
    x: 1100,
    y: 450,
  },
  {
    id: "vermouth",
    name: "Vermouth / Chris Vineyard",
    aliases: ["Chris Vineyard", "Sharon Vineyard"],
    role: "Master of disguise who knows Conan's and Sherry's truths",
    affiliation: "Black Organization",
    bio: "The Organization's legendary master of disguise, secretly an American actress doubling as her own 'daughter.' Vermouth hides her knowledge of Conan and Haibara's identities behind a web of lies.",
    x: 1200,
    y: 250,
  },
  {
    id: "rum",
    name: "Rum",
    role: "Top-tier Black Organization operative, identity narrowed to Kuroda/Wakita/Wakasa",
    affiliation: "Black Organization",
    bio: "The Organization's highest-ranking executive, whose true identity remains a central mystery.",
    x: 1300,
    y: 400,
  },
  {
    id: "chianti",
    name: "Chianti",
    role: "Black Organization sniper",
    affiliation: "Black Organization",
    bio: "A female sniper for the Black Organization, working alongside Korn.",
    x: 1150,
    y: 520,
  },
  {
    id: "korn",
    name: "Korn",
    role: "Black Organization sniper, Chianti's partner",
    affiliation: "Black Organization",
    bio: "A male sniper for the Black Organization, Chianti's taciturn and deadly partner.",
    x: 1200,
    y: 530,
  },
  {
    id: "calvados",
    name: "Calvados",
    role: "Black Organization sniper, deceased (killed by Akai)",
    affiliation: "Black Organization (deceased)",
    bio: "A deceased Black Organization sniper who was killed by Shuichi Akai.",
    x: 1250,
    y: 480,
  },
  {
    id: "tequila",
    name: "Tequila",
    role: "Mid-level Black Organization operative",
    affiliation: "Black Organization",
    bio: "A mid-level operative for the Black Organization who met a fiery end.",
    x: 1100,
    y: 380,
  },
  {
    id: "akemi-miyano",
    name: "Akemi Miyano",
    role: "Shiho's sister and Akai's lost love",
    affiliation: "Black Organization (deceased)",
    bio: "Shiho's older sister, an Organization operative who tried to leave and paid with her life. Akemi's death drives both Shiho's defection and Akai's deep, unreconciled grief.",
    x: 1050,
    y: 500,
  },

  // ─── Kaito Kuroba's Parents (previously missing) ───────────────────────
  {
    id: "toichi-kuroba",
    name: "Toichi Kuroba",
    role: "The original Kaitou Kid, presumed dead",
    affiliation: "Kaito Kid Legacy",
    bio: "Kaito's father and the original Kaitou Kid, presumed dead in a magic-show accident. A close friend of Yusaku Kudo and mentor to Kaito's art of misdirection.",
    x: 920,
    y: 40,
  },
  {
    id: "chikage-kuroba",
    name: "Chikage Kuroba",
    role: "Phantom Lady, Kaito's mother",
    affiliation: "Kaito Kid Legacy",
    bio: "Kaito's mother, once the phantom thief Phantom Lady in her youth. She knows both Toichi's and Kaito's double lives and watches over her son from afar.",
    x: 980,
    y: 110,
  },

  // ─── Miyano Family (previously missing) ─────────────────────────────────
  {
    id: "atsushi-miyano",
    name: "Atsushi Miyano",
    role: "Deceased Black Org scientist, APTX co-developer",
    affiliation: "Miyano Family",
    bio: "Ai's father, a deceased scientist affiliated with the Black Organization who co-developed APTX 4869 alongside his wife Elena.",
    x: 1240,
    y: 180,
  },
  {
    id: "elena-miyano",
    name: "Elena Miyano",
    role: "Deceased Black Org scientist, APTX co-developer",
    affiliation: "Miyano Family",
    bio: "Ai's mother, a deceased scientist affiliated with the Black Organization who co-developed APTX 4869. Her quiet legacy haunts Ai's defection.",
    x: 1280,
    y: 220,
  },

  // ─── Akai / Sera Family Extension ───────────────────────────────────────
  {
    id: "tsutomu-akai",
    name: "Tsutomu Akai",
    role: "MI6 agent, father of Shuichi & Masumi, missing 17 years",
    affiliation: "Akai Family / MI6",
    bio: "Father of Shuichi and Masumi, an MI6 agent who vanished investigating a Rum-linked case 17 years ago. His disappearance drives the Akai family mystery.",
    x: 700,
    y: 580,
  },
  {
    id: "kohji-haneda",
    name: "Kohji Haneda",
    role: "Deceased shogi champion, Rum clue",
    affiliation: "Haneda Family",
    bio: "A deceased shogi champion whose dying message first hinted at Rum's existence. His case ties Shukichi, Amanda, and Asaka together.",
    x: 900,
    y: 520,
  },
  {
    id: "amanda-hughes",
    name: "Amanda Hughes",
    role: "Wealthy American investor, victim in Kohji case",
    affiliation: "Civilian",
    bio: "A wealthy American investor found dead alongside Kohji Haneda. Her bodyguard Asaka vanished after her death, deepening the Rum mystery.",
    x: 920,
    y: 600,
  },
  {
    id: "asaka",
    name: "Asaka",
    role: "Amanda Hughes's missing bodyguard",
    affiliation: "Civilian",
    bio: "Amanda Hughes's bodyguard who vanished after her death. Rum is suspected to be Asaka, tying the 17-year-old case to the present.",
    x: 860,
    y: 620,
  },

  // ─── FBI Additions ──────────────────────────────────────────────────────
  {
    id: "andre-camel",
    name: "Andre Camel",
    role: "FBI agent who exposed Akai as Rye",
    affiliation: "FBI",
    bio: "An FBI agent who once accidentally exposed Shuichi Akai as the mole Rye inside the Black Organization. Loyal and earnest, he now works to redeem that mistake.",
    x: 580,
    y: 500,
  },

  // ─── Black Organization Additions ───────────────────────────────────────
  {
    id: "kanenori-wakita",
    name: "Kanenori Wakita",
    role: "Sushi chef, Rum suspect",
    affiliation: "Black Organization",
    bio: "A sushi chef and one of the three narrowed Rum suspects alongside Kuroda and Wakasa. His jovial mask may hide the Organization's second-in-command.",
    x: 1350,
    y: 360,
  },
  {
    id: "irish",
    name: "Irish",
    role: "Black Organization operative (film)",
    affiliation: "Black Organization",
    bio: "A film-only Black Organization operative with a personal vendetta against Gin. His infiltration of the police tests the Organization's reach.",
    x: 1180,
    y: 400,
  },
  {
    id: "pinga",
    name: "Pinga",
    role: "Lower operative, Black Iron Submarine",
    affiliation: "Black Organization",
    bio: "A lower-tier operative introduced in the Black Iron Submarine film continuity. Their presence hints at the Organization's wider network.",
    x: 1220,
    y: 420,
  },

  // ─── Regional Police Additions ──────────────────────────────────────────
  {
    id: "misae-yamamura",
    name: "Misae Yamamura",
    role: "Misao's grandmother, sharp witness",
    affiliation: "Civilian",
    bio: "Misao Yamamura's spirited grandmother who occasionally aids his cases with sharp testimony and old-fashioned wisdom.",
    x: 20,
    y: 720,
  },
  {
    id: "otaki",
    name: "Otaki",
    role: "Osaka detective, Yamamura's friend",
    affiliation: "Osaka Police",
    bio: "A recurring Osaka detective and friend to Misao Yamamura, often bridging Osaka and Tokyo cases.",
    x: 180,
    y: 520,
  },
  {
    id: "kiyonaga-matsumoto",
    name: "Kiyonaga Matsumoto",
    role: "MPD Superintendent",
    affiliation: "Tokyo Metropolitan Police",
    bio: "Superintendent of the Tokyo MPD, a stern but fair leader who oversees Megure's homicide division.",
    x: 420,
    y: 540,
  },
  {
    id: "shizuka-hattori",
    name: "Shizuka Hattori",
    role: "Heiji's mother, kendo master",
    affiliation: "Hattori Family",
    bio: "Heiji's mother, a graceful kendo master who quietly watches over her headstrong son and his Osaka cases.",
    x: 60,
    y: 350,
  },
  {
    id: "tomoaki-araide",
    name: "Tomoaki Araide",
    role: "Physician, Vermouth's disguise persona",
    affiliation: "Civilian",
    bio: "A kind physician whose identity Vermouth stole as a disguise. His return exposes the depth of her impersonation.",
    x: 1150,
    y: 200,
  },
  {
    id: "yoko-okino",
    name: "Yoko Okino",
    role: "Pop idol, Kogoro's crush",
    affiliation: "Media / Celebrity",
    bio: "A beloved pop idol and recurring character whose cases often pull in Conan, Ran, and Sonoko. Kogoro's not-so-secret celebrity crush.",
    x: 320,
    y: 500,
  },

  // ─── Minor Regional Detectives (previously missing) ─────────────────────
  {
    id: "fumimaro-ayanokoji",
    name: "Fumimaro Ayanokoji",
    role: "Kyoto inspector, Karasuma connection",
    affiliation: "Kyoto Police",
    bio: "A refined Kyoto inspector with a chipmunk companion, tied to the Karasuma estate and the Rum investigation.",
    x: 500,
    y: 620,
  },
  {
    id: "tamekichi-matsushiro",
    name: "Tamekichi Matsushiro",
    role: "Nagano detective",
    affiliation: "Nagano Police",
    bio: "A named-but-minor Nagano detective, part of the extended regional police network.",
    x: 100,
    y: 640,
  },
  {
    id: "kyohei-nishimura",
    name: "Kyohei Nishimura",
    role: "Hokkaido / Shizuoka detective",
    affiliation: "Shizuoka Police",
    bio: "A regional detective from the extended prefectural network, occasionally assisting Tokyo cases.",
    x: 220,
    y: 620,
  },
  {
    id: "detective-tamura",
    name: "Detective Tamura",
    role: "Regional detective",
    affiliation: "Regional Police",
    bio: "A named regional detective from the wider prefectural network.",
    x: 160,
    y: 700,
  },
  {
    id: "detective-kurumazaki",
    name: "Detective Kurumazaki",
    role: "Kyoto police, Ayanokoji's aide",
    affiliation: "Kyoto Police",
    bio: "A Kyoto police aide to Inspector Ayanokoji, diligent and soft-spoken.",
    x: 540,
    y: 600,
  },
  {
    id: "tsuyoshi-shikatsuno",
    name: "Tsuyoshi Shikatsuno",
    role: "Regional detective",
    affiliation: "Regional Police",
    bio: "A named regional detective in the extended network.",
    x: 180,
    y: 740,
  },
  {
    id: "shoji-terabayashi",
    name: "Shoji Terabayashi",
    role: "Regional detective",
    affiliation: "Regional Police",
    bio: "A named regional detective in the extended network.",
    x: 200,
    y: 780,
  },
]

/** Typed edges linking the cast (98 edges). */
export const RELATIONSHIPS: Relationship[] = [
  // — Conan / Shinichi core (hub, 8 edges)
  {
    id: "conan-ran-romance",
    source: "conan-edogawa",
    target: "ran-mouri",
    type: "romance",
    detail:
      "Childhood friends and slow-burn mutual love; Ran waits for Shinichi's return while he lives beside her as Conan, helpless to confess.",
  },
  {
    id: "conan-ran-friendship",
    source: "conan-edogawa",
    target: "ran-mouri",
    type: "friendship",
    detail:
      "A childhood bond of trust and care; even as Conan he protects Ran at every turn, and she mothers him without knowing who he is.",
  },
  {
    id: "conan-kogoro-secret-identity",
    source: "conan-edogawa",
    target: "kogoro-mouri",
    type: "secret_identity",
    detail:
      "Conan secretly solves Kogoro's cases, knocking him out to voice deductions as the 'Sleeping Kogoro.'",
  },
  {
    id: "conan-haibara-secret-identity",
    source: "conan-edogawa",
    target: "ai-haibara",
    type: "secret_identity",
    detail:
      "The only two who share the APTX secret: Conan knows Haibara is Shiho Miyano / Sherry, and she knows he is Shinichi Kudo.",
  },
  {
    id: "conan-agasa-mentor",
    source: "conan-edogawa",
    target: "professor-agasa",
    type: "mentor",
    detail:
      "Agasa mentors Conan and supplies his gadgets — an ally who knows his secret and shelters both him and Ai Haibara.",
  },
  {
    id: "conan-heiji-rivalry",
    source: "conan-edogawa",
    target: "heiji-hattori",
    type: "rivalry",
    detail:
      "Osaka's detective and Tokyo's detective compete case by case; Heiji is one of the few who knows Conan's true identity.",
  },
  {
    id: "conan-kaitou-kid-rivalry",
    source: "conan-edogawa",
    target: "kaitou-kid",
    type: "rivalry",
    detail:
      "The phantom thief steals Conan's spotlight in heist after heist, a dance of chase the detective never quite wins.",
  },
  {
    id: "conan-gin-adversary",
    source: "conan-edogawa",
    target: "gin",
    type: "adversary",
    detail:
      "Gin shrank Shinichi and hunted him at the pier; the detective and the killer circle each other unseen across the series.",
  },

  // — Mouri family
  {
    id: "ran-kogoro-family",
    source: "ran-mouri",
    target: "kogoro-mouri",
    type: "family",
    detail:
      "Devoted daughter to her unreliable but loving father, whom she manages alongside her own detective dreams.",
  },
  {
    id: "ran-eri-family",
    source: "ran-mouri",
    target: "eri-kisaki",
    type: "family",
    detail:
      "Ran is the daughter of the long-separated Eri Kisaki, caught between her parents' stubborn estrangement.",
  },
  {
    id: "kogoro-eri-romance",
    source: "kogoro-mouri",
    target: "eri-kisaki",
    type: "romance",
    detail:
      "Long-separated spouses who still carry a mutual, unspoken love behind years of pride and misunderstanding.",
  },
  {
    id: "kogoro-megure-colleague",
    source: "kogoro-mouri",
    target: "inspector-megure",
    type: "colleague",
    detail:
      "Former police colleagues; Megure still brings his most baffling cases to the 'Sleeping Kogoro.'",
  },

  // — Professor Agasa
  {
    id: "agasa-haibara-friendship",
    source: "professor-agasa",
    target: "ai-haibara",
    type: "friendship",
    detail:
      "Agasa takes in the shrunken Shiho as Ai Haibara, sheltering her and supporting the defector's new life.",
  },
  {
    id: "agasa-ayumi-mentor",
    source: "professor-agasa",
    target: "ayumi-yoshida",
    type: "mentor",
    detail:
      "Agasa mentors the Detective Boys, lending gadgets and guidance to their mini investigations.",
  },
  {
    id: "agasa-genta-mentor",
    source: "professor-agasa",
    target: "genta-kojima",
    type: "mentor",
    detail:
      "Agasa keeps the Detective Boys supplied with inventions and snacks, their de facto grown-up ally.",
  },
  {
    id: "agasa-mitsuhiko-mentor",
    source: "professor-agasa",
    target: "mitsuhiko-tsuburaya",
    type: "mentor",
    detail:
      "Mitsuhiko's science questions find a kindred inventor in Agasa, who fuels the boy's curiosity.",
  },
  {
    id: "agasa-yusaku-friendship",
    source: "professor-agasa",
    target: "yusaku-kudo",
    type: "friendship",
    detail:
      "Old friends of the Kudo house; Agasa guards Shinichi's secret under the family's trust.",
  },

  // — Detective Boys
  {
    id: "ayumi-genta-friendship",
    source: "ayumi-yoshida",
    target: "genta-kojima",
    type: "friendship",
    detail:
      "Close, bickering classmates of the Detective Boys who always have each other's backs.",
  },
  {
    id: "ayumi-mitsuhiko-friendship",
    source: "ayumi-yoshida",
    target: "mitsuhiko-tsuburaya",
    type: "friendship",
    detail:
      "Mitsuhiko holds a soft, bookish crush on Ayumi, who treats him as a dear friend.",
  },
  {
    id: "genta-mitsuhiko-friendship",
    source: "genta-kojima",
    target: "mitsuhiko-tsuburaya",
    type: "friendship",
    detail:
      "Inseparable teammates in the Detective Boys, trading quips and courage across cases.",
  },
  {
    id: "ayumi-haibara-mentor",
    source: "ayumi-yoshida",
    target: "ai-haibara",
    type: "mentor",
    detail:
      "Ayumi quietly looks up to Haibara's poise, and Haibara shields the gentle girl from darker truths.",
  },

  // — Ai Haibara
  {
    id: "haibara-akemi-family",
    source: "ai-haibara",
    target: "akemi-miyano",
    type: "family",
    detail:
      "Shiho's beloved older sister, whose murder at the Organization's hands drove her to defect.",
  },
  {
    id: "haibara-gin-adversary",
    source: "ai-haibara",
    target: "gin",
    type: "adversary",
    detail:
      "Gin murdered her sister and hunts the defector Sherry; Haibara lives in terror of his cold pursuit.",
  },
  {
    id: "haibara-vermouth-adversary",
    source: "ai-haibara",
    target: "vermouth",
    type: "adversary",
    detail:
      "The master of disguise hunts Sherry while sparing Conan; Haibara fears Vermouth above nearly all.",
  },
  {
    id: "haibara-vermouth-secret-identity",
    source: "ai-haibara",
    target: "vermouth",
    type: "secret_identity",
    detail:
      "Vermouth alone knows Haibara is the escaped Sherry — a secret that makes her a constant target.",
  },

  // — Heiji & Kazuha
  {
    id: "heiji-kazuha-romance",
    source: "heiji-hattori",
    target: "kazuha-toyama",
    type: "romance",
    detail:
      "Childhood friends in a slow-burn romance; Heiji is too stubborn to confess while Kazuha quietly waits.",
  },
  {
    id: "heiji-kazuha-friendship",
    source: "heiji-hattori",
    target: "kazuha-toyama",
    type: "friendship",
    detail:
      "Kazuha protects Heiji with aikido and follows him into danger, an unbreakable bond of trust.",
  },
  {
    id: "ran-heiji-friendship",
    source: "ran-mouri",
    target: "heiji-hattori",
    type: "friendship",
    detail:
      "Ran and Heiji share a friendly bond as Shinichi's two closest peers; Heiji knows her waiting love.",
  },
  {
    id: "ran-kazuha-friendship",
    source: "ran-mouri",
    target: "kazuha-toyama",
    type: "friendship",
    detail:
      "Mirror-image childhood friends who bond over waiting for brilliant, oblivious detectives.",
  },
  {
    id: "heiji-masumi-colleague",
    source: "heiji-hattori",
    target: "masumi-sera",
    type: "colleague",
    detail:
      "Two sharp high-school detectives who size each other up across cases, trading deductions.",
  },

  // — Sonoko, Makoto & Kid
  {
    id: "ran-sonoko-friendship",
    source: "ran-mouri",
    target: "sonoko-suzuki",
    type: "friendship",
    detail:
      "School best friends; Sonoko and Ran confide in each other about their loves and the detectives in their lives.",
  },
  {
    id: "sonoko-kyogoku-romance",
    source: "sonoko-suzuki",
    target: "makoto-kyogoku",
    type: "romance",
    detail:
      "Karate champion and heiress in a devoted romance; Makoto proves his love by risking everything for Sonoko.",
  },
  {
    id: "sonoko-kyogoku-friendship",
    source: "sonoko-suzuki",
    target: "makoto-kyogoku",
    type: "friendship",
    detail:
      "Beyond romance, the karate king and the heiress share a steady affection that anchors Sonoko's fickle heart.",
  },
  {
    id: "ran-kyogoku-rivalry",
    source: "ran-mouri",
    target: "makoto-kyogoku",
    type: "rivalry",
    detail:
      "National karate rivals who fought to a draw; Makoto won Ran's wary respect in the ring.",
  },
  {
    id: "sonoko-kaitou-kid-rivalry",
    source: "sonoko-suzuki",
    target: "kaitou-kid",
    type: "rivalry",
    detail:
      "Sonoko idolizes Kid yet foils — and is rescued by — his heists, a flirtatious dance of thief and heiress.",
  },
  {
    id: "kyogoku-kaitou-kid-rivalry",
    source: "makoto-kyogoku",
    target: "kaitou-kid",
    type: "rivalry",
    detail:
      "Makoto once clinched victory over the phantom thief in an arm-wrestling duel for Sonoko's honor.",
  },
  {
    id: "kid-nakamori-rivalry",
    source: "kaitou-kid",
    target: "ginzo-nakamori",
    type: "rivalry",
    detail:
      "Nakamori has lost more heists to the phantom thief than anyone can count — and never stops swearing the next one is his.",
  },
  {
    id: "kid-yusaku-rivalry",
    source: "kaitou-kid",
    target: "yusaku-kudo",
    type: "rivalry",
    detail:
      "Yusaku once outwitted the phantom thief in a legendary heist gambit, cementing his detective legend.",
  },

  // — Black Organization
  {
    id: "gin-vodka-colleague",
    source: "gin",
    target: "vodka",
    type: "colleague",
    detail:
      "Gin's trusted driver and enforcer, the duo behind the series-opening poisoning of Shinichi Kudo.",
  },
  {
    id: "gin-vermouth-colleague",
    source: "gin",
    target: "vermouth",
    type: "colleague",
    detail:
      "Two elite operatives who distrust each other, their icy partnership a weapon within the Organization.",
  },
  {
    id: "vodka-vermouth-colleague",
    source: "vodka",
    target: "vermouth",
    type: "colleague",
    detail:
      "Vodka defers to Vermouth's rank and her unsettling talent for wearing other faces.",
  },
  {
    id: "gin-akai-adversary",
    source: "gin",
    target: "shuichi-akai",
    type: "adversary",
    detail:
      "An FBI marksman who dismantled Gin's master plan; Gin wants Akai dead more than any other target.",
  },
  {
    id: "akemi-gin-adversary",
    source: "akemi-miyano",
    target: "gin",
    type: "adversary",
    detail:
      "Gin executed Akemi for trying to leave the Organization, sealing the tragedy that broke its youngest members free.",
  },
  {
    id: "vermouth-amuro-colleague",
    source: "vermouth",
    target: "tooru-amuro",
    type: "colleague",
    detail:
      "Vermouth distrusts Bourbon's motives, yet they stand as the Organization's sharpest operatives.",
  },
  {
    id: "vermouth-amuro-adversary",
    source: "vermouth",
    target: "tooru-amuro",
    type: "adversary",
    detail:
      "Each hides ulterior loyalties; their guarded sparring is a cold war inside the Organization.",
  },
  {
    id: "akai-amuro-adversary",
    source: "shuichi-akai",
    target: "tooru-amuro",
    type: "adversary",
    detail:
      "Bourbon obsessed over the FBI's 'deceased' Akai; their hatred predates the series and drives still-unresolved feuds.",
  },
  {
    id: "amuro-megure-colleague",
    source: "tooru-amuro",
    target: "inspector-megure",
    type: "colleague",
    detail:
      "As detective Toru Amuro, Bourbon works cases with the MPD while guarding his hidden loyalties.",
  },

  // — FBI & Akai
  {
    id: "akai-akemi-romance",
    source: "shuichi-akai",
    target: "akemi-miyano",
    type: "romance",
    detail:
      "Akai loved Akemi as an undercover agent; her death haunts him as an agent and a man.",
  },
  {
    id: "akai-masumi-family",
    source: "shuichi-akai",
    target: "masumi-sera",
    type: "family",
    detail:
      "Masumi's older brother, presumed dead; she hunts the truth of his fate across Japan.",
  },
  {
    id: "akai-mary-family",
    source: "shuichi-akai",
    target: "mary-sera",
    type: "family",
    detail:
      "Mary's son; her shrunken identity remains his guarded family secret.",
  },
  {
    id: "akai-jodie-colleague",
    source: "shuichi-akai",
    target: "jodie-starling",
    type: "colleague",
    detail:
      "FBI partners under James Black, bound by the Organization hunt and a tangled, once-romantic history.",
  },
  {
    id: "akai-james-colleague",
    source: "shuichi-akai",
    target: "james-black",
    type: "colleague",
    detail:
      "Trusted agent and his calm supervisor, coordinating the FBI's Japanese operations.",
  },
  {
    id: "jodie-james-colleague",
    source: "jodie-starling",
    target: "james-black",
    type: "colleague",
    detail:
      "James mentors and supervises Jodie as she pursues the Organization that orphaned her.",
  },
  {
    id: "jodie-vermouth-adversary",
    source: "jodie-starling",
    target: "vermouth",
    type: "adversary",
    detail:
      "Vermouth killed Jodie's father; Jodie hunts the actress who once masqueraded as her teacher.",
  },
  {
    id: "masumi-mary-family",
    source: "masumi-sera",
    target: "mary-sera",
    type: "family",
    detail:
      "Mother and daughter; Masumi guards Mary's shrunken secret while pressing to find her brother.",
  },
  {
    id: "yukiko-vermouth-secret-identity",
    source: "yukiko-kudo",
    target: "vermouth",
    type: "secret_identity",
    detail:
      "Rivals in the art of disguise — the actress once met the master spy, each aware of the other's craft.",
  },

  // — Tokyo Metropolitan Police
  {
    id: "nakamori-megure-colleague",
    source: "ginzo-nakamori",
    target: "inspector-megure",
    type: "colleague",
    detail:
      "Fellow inspectors trading cases — Megure's homicides and Nakamori's heists often collide in Tokyo.",
  },
  {
    id: "megure-sato-colleague",
    source: "inspector-megure",
    target: "officer-sato",
    type: "colleague",
    detail:
      "Megure's ace detective; he counts on Sato's nerve and judgment at the worst crime scenes.",
  },
  {
    id: "megure-takagi-colleague",
    source: "inspector-megure",
    target: "officer-takagi",
    type: "colleague",
    detail:
      "Megure's dependable, easily flustered subordinate, always a step behind the cleverest suspects.",
  },
  {
    id: "sato-takagi-romance",
    source: "officer-sato",
    target: "officer-takagi",
    type: "romance",
    detail:
      "The MPD's slow-burn romance: Sato has loved Takagi across years of near-misses and stubborn pride.",
  },
  {
    id: "sato-takagi-colleague",
    source: "officer-sato",
    target: "officer-takagi",
    type: "colleague",
    detail:
      "Partner detectives who cover each other's backs on every case, the squad's most reliable duo.",
  },

  // — Kudo parents
  {
    id: "yusaku-yukiko-romance",
    source: "yusaku-kudo",
    target: "yukiko-kudo",
    type: "romance",
    detail:
      "Writer and actress, a love story of geniuses who met, married, and solve cases together.",
  },
  {
    id: "yusaku-yukiko-family",
    source: "yusaku-kudo",
    target: "yukiko-kudo",
    type: "family",
    detail:
      "Husband and wife, parents of Shinichi and the rare pair Conan fully trusts with his secret.",
  },

  // ─── NEW RELATIONSHIPS ─────────────────────────────────────────────

  // — Suzuki family
  {
    id: "sonoko-shiro-family",
    source: "sonoko-suzuki",
    target: "shiro-suzuki",
    type: "family",
    detail: "Father and daughter; Shiro is the patriarch of the Suzuki family.",
  },
  {
    id: "sonoko-tomoko-family",
    source: "sonoko-suzuki",
    target: "tomoko-suzuki",
    type: "family",
    detail: "Mother and daughter; Tomoko is Sonoko's mother.",
  },
  {
    id: "sonoko-ayako-family",
    source: "sonoko-suzuki",
    target: "ayako-suzuki",
    type: "family",
    detail: "Sisters; Ayako is Sonoko's older sister.",
  },
  {
    id: "ayako-yuzo-family",
    source: "ayako-suzuki",
    target: "yuzo-tomizawa",
    type: "family",
    detail: "Married couple; Yuzo is Sonoko's brother-in-law.",
  },
  {
    id: "jirokichi-kaitou-kid-rivalry",
    source: "jirokichi-suzuki",
    target: "kaitou-kid",
    type: "rivalry",
    detail:
      "Jirokichi funds elaborate traps to catch Kid, who always escapes.",
  },
  {
    id: "shiro-jirokichi-family",
    source: "shiro-suzuki",
    target: "jirokichi-suzuki",
    type: "family",
    detail: "Uncle and nephew; Jirokichi is Sonoko's great-uncle.",
  },

  // — Kaito Kid side
  {
    id: "kaitou-kid-aoko-romance",
    source: "kaitou-kid",
    target: "aoko-nakamori",
    type: "romance",
    detail:
      "Kaito's childhood friend and love interest, unaware of his double life.",
  },
  {
    id: "aoko-ginzo-family",
    source: "aoko-nakamori",
    target: "ginzo-nakamori",
    type: "family",
    detail: "Father and daughter; Ginzo is Aoko's father.",
  },
  {
    id: "kaitou-kid-saguru-rivalry",
    source: "kaitou-kid",
    target: "saguru-hakuba",
    type: "rivalry",
    detail: "Hakuba suspects Kaito is Kid and investigates.",
  },
  {
    id: "kaitou-kid-jii-friendship",
    source: "kaitou-kid",
    target: "jii-konosuke",
    type: "friendship",
    detail:
      "Jii was Toichi Kuroba's old assistant, now Kaito's trusted aide and butler figure.",
  },

  // — Tokyo MPD
  {
    id: "megure-shiratori-colleague",
    source: "inspector-megure",
    target: "ninzaburo-shiratori",
    type: "colleague",
    detail: "Fellow MPD detectives working the same precinct.",
  },
  {
    id: "megure-chiba-colleague",
    source: "inspector-megure",
    target: "kazunobu-chiba",
    type: "colleague",
    detail: "Megure's reliable subordinate in the MPD.",
  },
  {
    id: "megure-kuroda-colleague",
    source: "inspector-megure",
    target: "hyoue-kuroda",
    type: "colleague",
    detail: "Megure reports to the high-ranking Kuroda.",
  },
  {
    id: "sato-shiratori-colleague",
    source: "officer-sato",
    target: "ninzaburo-shiratori",
    type: "colleague",
    detail: "Shiratori harbors unrequited feelings for Sato.",
  },
  {
    id: "sato-chiba-colleague",
    source: "officer-sato",
    target: "kazunobu-chiba",
    type: "colleague",
    detail: "Fellow MPD detectives in the same squad.",
  },
  {
    id: "chiba-naeko-family",
    source: "kazunobu-chiba",
    target: "naeko-miike",
    type: "family",
    detail: "Married couple.",
  },
  {
    id: "takagi-shiratori-rivalry",
    source: "officer-takagi",
    target: "ninzaburo-shiratori",
    type: "rivalry",
    detail: "Both compete for Sato's affection.",
  },
  {
    id: "chaki-nakamori-colleague",
    source: "shintaro-chaki",
    target: "ginzo-nakamori",
    type: "colleague",
    detail: "Chaki oversees the Kid task force that Nakamori leads.",
  },

  // — Regional Police
  {
    id: "heiji-heizo-family",
    source: "heiji-hattori",
    target: "heizo-hattori",
    type: "family",
    detail: "Father and son.",
  },
  {
    id: "kazuha-ginshiro-family",
    source: "kazuha-toyama",
    target: "ginshiro-toyama",
    type: "family",
    detail: "Father and daughter.",
  },
  {
    id: "kansuke-yui-friendship",
    source: "kansuke-yamato",
    target: "yui-uehara",
    type: "friendship",
    detail:
      "Childhood friends, deep bond; Yamato is cold but protective.",
  },
  {
    id: "sango-jugo-family",
    source: "sango-yokomizo",
    target: "jugo-yokomizo",
    type: "family",
    detail: "Twins who collaborate across districts.",
  },

  // — FBI / CIA
  {
    id: "shukichi-akai-family",
    source: "shukichi-haneda",
    target: "shuichi-akai",
    type: "family",
    detail:
      "Tied through the Akai family; Shukichi appears in the Nagano/Scarlet arc.",
  },
  {
    id: "kir-gin-colleague",
    source: "kir",
    target: "gin",
    type: "colleague",
    detail:
      "Kir serves as Gin's informant while secretly feeding the CIA.",
  },
  {
    id: "kir-vermouth-colleague",
    source: "kir",
    target: "vermouth",
    type: "colleague",
    detail: "Both operate within the Organization; Kir is the CIA mole.",
  },
  {
    id: "kir-renya-colleague",
    source: "kir",
    target: "renya-karasuma",
    type: "colleague",
    detail: "Kir reports to the Boss through the chain.",
  },

  // — Black Organization
  {
    id: "renya-gin-colleague",
    source: "renya-karasuma",
    target: "gin",
    type: "colleague",
    detail: "Gin serves the Boss directly, the most loyal enforcer.",
  },
  {
    id: "renya-vermouth-colleague",
    source: "renya-karasuma",
    target: "vermouth",
    type: "colleague",
    detail: "Vermouth serves the Boss but hides her own agenda.",
  },
  {
    id: "renya-yusaku-rivalry",
    source: "renya-karasuma",
    target: "yusaku-kudo",
    type: "rivalry",
    detail: "Old acquaintance and rival of Yusaku Kudo.",
  },
  {
    id: "gin-chianti-colleague",
    source: "gin",
    target: "chianti",
    type: "colleague",
    detail: "Gin commands the sniper duo.",
  },
  {
    id: "gin-korn-colleague",
    source: "gin",
    target: "korn",
    type: "colleague",
    detail: "Korn follows Gin's orders as a sniper.",
  },
  {
    id: "gin-rum-colleague",
    source: "gin",
    target: "rum",
    type: "colleague",
    detail: "Rum is Gin's superior in the Organization hierarchy.",
  },
  {
    id: "vermouth-rum-colleague",
    source: "vermouth",
    target: "rum",
    type: "colleague",
    detail: "Rum outranks Vermouth; their relationship is tense.",
  },
  {
    id: "chianti-korn-colleague",
    source: "chianti",
    target: "korn",
    type: "colleague",
    detail: "Sniper partners in the Organization.",
  },
  {
    id: "gin-tequila-colleague",
    source: "gin",
    target: "tequila",
    type: "colleague",
    detail: "Mid-level operative under Gin's sphere.",
  },
  {
    id: "calvados-vermouth-colleague",
    source: "calvados",
    target: "vermouth",
    type: "colleague",
    detail:
      "Calvados was Vermouth's bodyguard before Akai killed him.",
  },

  // — PSB / Regional cross-links
  {
    id: "morofushi-amuro-friendship",
    source: "hiromitsu-morofushi",
    target: "tooru-amuro",
    type: "friendship",
    detail:
      "Childhood friends turned opposing double agents; Scotch's death haunts Furuya.",
  },
  {
    id: "morofushi-yamamura-friendship",
    source: "hiromitsu-morofushi",
    target: "misao-yamamura",
    type: "friendship",
    detail:
      "Childhood friends; Scotch's death was a tragic loss for Yamamura.",
  },
  {
    id: "kuroda-amuro-colleague",
    source: "hyoue-kuroda",
    target: "tooru-amuro",
    type: "colleague",
    detail:
      "Kuroda oversees PSB operations that intersect with Bourbon.",
  },
  {
    id: "morofushi-matsuda-mentor",
    source: "hiromitsu-morofushi",
    target: "jinpei-matsuda",
    type: "mentor",
    detail:
      "Matsuda was Furuya's mentor; Morofushi knew him through PSB.",
  },

  // — Kaito Kuroba parents
  {
    id: "toichi-kaito-family",
    source: "toichi-kuroba",
    target: "kaitou-kid",
    type: "family",
    detail: "Father and son; Toichi was the original Kaitou Kid before Kaito inherited the mantle.",
  },
  {
    id: "toichi-yusaku-friendship",
    source: "toichi-kuroba",
    target: "yusaku-kudo",
    type: "friendship",
    detail: "Old friends; Yusaku knew Toichi's secret and once outwitted his heist.",
  },
  {
    id: "chikage-kaito-family",
    source: "chikage-kuroba",
    target: "kaitou-kid",
    type: "family",
    detail: "Mother and son; Chikage knows Kaito is Kid and once held the title Phantom Lady herself.",
  },
  {
    id: "toichi-chikage-family",
    source: "toichi-kuroba",
    target: "chikage-kuroba",
    type: "family",
    detail: "Husband and wife; the two phantom thieves of a previous generation.",
  },

  // — Miyano family
  {
    id: "atsushi-elena-family",
    source: "atsushi-miyano",
    target: "elena-miyano",
    type: "family",
    detail: "Husband and wife, co-developers of APTX 4869 for the Organization.",
  },
  {
    id: "atsushi-haibara-family",
    source: "atsushi-miyano",
    target: "ai-haibara",
    type: "family",
    detail: "Father and daughter; Atsushi's research doomed Ai to the Organization.",
  },
  {
    id: "elena-haibara-family",
    source: "elena-miyano",
    target: "ai-haibara",
    type: "family",
    detail: "Mother and daughter; Elena's quiet legacy haunts Ai's defection.",
  },
  {
    id: "atsushi-akemi-family",
    source: "atsushi-miyano",
    target: "akemi-miyano",
    type: "family",
    detail: "Father and daughter; Atsushi never lived to see Akemi's fate.",
  },

  // — Akai / Haneda extension
  {
    id: "tsutomu-shuichi-family",
    source: "tsutomu-akai",
    target: "shuichi-akai",
    type: "family",
    detail: "Father and son; Tsutomu's disappearance 17 years ago drives Shuichi's hunt for Rum.",
  },
  {
    id: "tsutomu-masumi-family",
    source: "tsutomu-akai",
    target: "masumi-sera",
    type: "family",
    detail: "Father and daughter; Masumi never knew her father's fate.",
  },
  {
    id: "tsutomu-mary-family",
    source: "tsutomu-akai",
    target: "mary-sera",
    type: "family",
    detail: "Husband and wife; Mary and Tsutomu's shared MI6 past ties to the Haneda case.",
  },
  {
    id: "kohji-shukichi-family",
    source: "kohji-haneda",
    target: "shukichi-haneda",
    type: "family",
    detail: "Brothers? No — Kohji's death and Shukichi's shogi title are linked by the dying message that first named Rum.",
  },
  {
    id: "amanda-asaka-colleague",
    source: "amanda-hughes",
    target: "asaka",
    type: "colleague",
    detail: "Investor and bodyguard; Asaka vanished the night Amanda was murdered alongside Kohji.",
  },
  {
    id: "amanda-kohji-colleague",
    source: "amanda-hughes",
    target: "kohji-haneda",
    type: "colleague",
    detail: "Both victims of the same 17-year-old double murder that first exposed Rum.",
  },

  // — FBI addition
  {
    id: "camel-akai-colleague",
    source: "andre-camel",
    target: "shuichi-akai",
    type: "colleague",
    detail: "FBI partners; Camel once blew Akai's cover as Rye, a mistake he works to redeem.",
  },
  {
    id: "camel-jodie-colleague",
    source: "andre-camel",
    target: "jodie-starling",
    type: "colleague",
    detail: "Fellow FBI agents under James Black, coordinating the Japan operation.",
  },

  // — Black Org additions
  {
    id: "wakita-gin-colleague",
    source: "kanenori-wakita",
    target: "gin",
    type: "colleague",
    detail: "Rum suspect and elite operative; Wakita's jovial sushi-chef cover hides his rank.",
  },
  {
    id: "irish-gin-colleague",
    source: "irish",
    target: "gin",
    type: "colleague",
    detail: "Film-only operative who infiltrated the police, driven by a personal vendetta against Gin.",
  },
  {
    id: "pinga-gin-colleague",
    source: "pinga",
    target: "gin",
    type: "colleague",
    detail: "Lower operative in the Black Iron Submarine continuity, part of the Organization's wider network.",
  },

  // — Regional additions
  {
    id: "misae-misao-family",
    source: "misae-yamamura",
    target: "misao-yamamura",
    type: "family",
    detail: "Grandmother and grandson; Misae's sharp testimony often saves Misao's cases.",
  },
  {
    id: "otaki-heiji-colleague",
    source: "otaki",
    target: "heiji-hattori",
    type: "colleague",
    detail: "Osaka detective who relies on Heiji's deductions across prefectural cases.",
  },
  {
    id: "matsumoto-megure-colleague",
    source: "kiyonaga-matsumoto",
    target: "inspector-megure",
    type: "colleague",
    detail: "Superintendent and inspector; Matsumoto oversees Megure's homicide division.",
  },
  {
    id: "shizuka-heiji-family",
    source: "shizuka-hattori",
    target: "heiji-hattori",
    type: "family",
    detail: "Mother and son; Shizuka's kendo grace steadies Heiji's brash detective life.",
  },
  {
    id: "araide-vermouth-secret-identity",
    source: "tomoaki-araide",
    target: "vermouth",
    type: "secret_identity",
    detail: "Vermouth stole Araide's identity as a disguise; his return exposes her craft.",
  },
  {
    id: "yoko-kogoro-friendship",
    source: "yoko-okino",
    target: "kogoro-mouri",
    type: "friendship",
    detail: "Pop idol and her self-proclaimed number-one fan; Yoko's cases often pull Kogoro into the spotlight.",
  },
  {
    id: "ayanokoji-megure-colleague",
    source: "fumimaro-ayanokoji",
    target: "inspector-megure",
    type: "colleague",
    detail: "Kyoto and Tokyo inspectors who collaborate across prefectures, linked by the Karasuma estate case.",
  },
]

export function getCharacterById(id: string): Character | undefined {
  return CHARACTERS.find((c) => c.id === id)
}

export function getCharacters(): Character[] {
  return CHARACTERS
}

export function getRelationships(): Relationship[] {
  return RELATIONSHIPS
}

export function getRelationshipsFor(characterId: string): Relationship[] {
  return RELATIONSHIPS.filter(
    (r) => r.source === characterId || r.target === characterId
  )
}

export function getRelationshipMeta(
  type: RelationshipType
): { label: string; color: string; description: string } {
  return RELATIONSHIP_META[type]
}

// ——— Spoiler gating (data lives in lib/characters-debut.ts) ———————————

export type { Debut, SpoilerLevel, SpoilerMeta, Visibility, WatchProgress } from "@/lib/characters-spoiler"

export { getSpoilerMeta } from "@/lib/characters-debut"

/** Every gateable id in the graph — used by the dev-only orphan check. */
export function getAllGateableIds(): string[] {
  return [...CHARACTERS.map((c) => c.id), ...RELATIONSHIPS.map((r) => r.id)]
}
