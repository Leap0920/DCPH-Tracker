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
  x: number
  y: number
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

/** Curated cast (30 nodes) on a 1000x600 canvas. */
export const CHARACTERS: Character[] = [
  {
    id: "conan-edogawa",
    name: "Conan Edogawa / Shinichi Kudo",
    aliases: ["Shinichi Kudo"],
    role: "The shrunken detective of Beika",
    affiliation: "Junior Detective League",
    bio: "High-school sleuth Shinichi Kudo, poisoned by the Black Organization's APTX 4869, shrinks to a child and hides as Conan Edogawa. He lives beside Ran as a child, solving cases he can never claim credit for while hunting the men who shrank him.",
    x: 380,
    y: 270,
  },
  {
    id: "ran-mouri",
    name: "Ran Mouri",
    role: "Childhood friend, karate champion, unwitting guardian",
    affiliation: "Mouri Family",
    bio: "Ran is Shinichi's dearest childhood friend and the daughter of Kogoro and Eri. A national karate champion, she waits years for Shinichi's return, unaware the boy she shelters is him.",
    x: 280,
    y: 330,
  },
  {
    id: "kogoro-mouri",
    name: "Kogoro Mouri",
    role: "The 'Sleeping Kogoro' private detective",
    affiliation: "Mouri Detective Agency",
    bio: "Ran's hard-drinking, sharp-eyed father runs a private detective agency. Conan secretly solves many of his cases, knocking him out to deliver deductions through the 'Sleeping Kogoro' act.",
    x: 250,
    y: 440,
  },
  {
    id: "professor-agasa",
    name: "Professor Hiroshi Agasa",
    role: "Inventor of Conan's gadgets and the Detective Boys' mentor",
    affiliation: "Beika Inventor & Supporting Cast",
    bio: "A brilliant absent-minded inventor and family friend of the Kudus. Agasa builds Conan's gadgets, shelters Ai Haibara, and invents the tools that turn the tide of countless cases.",
    x: 430,
    y: 150,
  },
  {
    id: "ayumi-yoshida",
    name: "Ayumi Yoshida",
    role: "Cheerful heart of the Detective Boys",
    affiliation: "Junior Detective League",
    bio: "The gentle, optimistic member of the Detective Boys who adores Conan. Ayumi brings warmth and intuition to the team's ad-hoc investigations around Beika.",
    x: 340,
    y: 60,
  },
  {
    id: "genta-kojima",
    name: "Genta Kojima",
    role: "Stout, hungry founding member of the Detective Boys",
    affiliation: "Junior Detective League",
    bio: "The self-appointed second-in-command of the Detective Boys, loyal and food-loving. Genta's uncanny memory and appetite often prove surprising assets in a pinch.",
    x: 480,
    y: 50,
  },
  {
    id: "mitsuhiko-tsuburaya",
    name: "Mitsuhiko Tsuburaya",
    role: "Bookish know-it-all of the Detective Boys",
    affiliation: "Junior Detective League",
    bio: "A studious, science-minded member of the Detective Boys who looks up to Conan. Mitsuhiko's textbook reasoning and gentle crush on Ayumi round out the trio.",
    x: 530,
    y: 70,
  },
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
    y: 380,
  },
  {
    id: "sonoko-suzuki",
    name: "Sonoko Suzuki",
    role: "Ran's best friend and the Suzuki Group heiress",
    affiliation: "Suzuki Family",
    bio: "Ran's lively best friend and heiress of the colossal Suzuki Group. Often the damsel in a Kid heist, Sonoko fancies herself a trendsetter and an amateur detective.",
    x: 170,
    y: 180,
  },
  {
    id: "makoto-kyogoku",
    name: "Makoto Kyogoku",
    role: "Sonoko's karate-champion boyfriend",
    affiliation: "Suzuki Family / Martial Arts Cast",
    bio: "A quiet, gentle giant and national karate champion who once tied with Ran. Makoto is utterly devoted to Sonoko, proving his love by defending her through impossible odds.",
    x: 90,
    y: 200,
  },
  {
    id: "kaitou-kid",
    name: "Kaitou Kid / Kaito Kuroba",
    aliases: ["Kaito Kuroba"],
    role: "The gentleman phantom thief",
    affiliation: "Phantom Thief Kid",
    bio: "The theatrical phantom thief whose impossible heists are a recurring puzzle for Conan. Behind the showman is high-schooler Kaito Kuroba, seeking the truth of his father's death.",
    x: 760,
    y: 90,
  },
  {
    id: "gin",
    name: "Gin",
    role: "Ruthless senior operative of the Black Organization",
    affiliation: "Black Organization",
    bio: "The cold, bloodthirsty operative who shrank Shinichi and believes Sherry dead. Gin's paranoia and cruelty make him the series' most dangerous sleeper threat to Conan.",
    x: 940,
    y: 350,
  },
  {
    id: "vodka",
    name: "Vodka",
    role: "Gin's loyal, blunt partner",
    affiliation: "Black Organization",
    bio: "Gin's driver and enforcer, competent but far less sharp than his senior. Vodka stood beside Gin the night Conan was poisoned, anchoring the pair to the series' origin.",
    x: 870,
    y: 450,
  },
  {
    id: "vermouth",
    name: "Vermouth / Chris Vineyard",
    aliases: ["Chris Vineyard", "Sharon Vineyard"],
    role: "Master of disguise who knows Conan's and Sherry's truths",
    affiliation: "Black Organization",
    bio: "The Organization's legendary master of disguise, secretly an American actress doubling as her own 'daughter.' Vermouth hides her knowledge of Conan and Haibara's identities behind a web of lies.",
    x: 940,
    y: 240,
  },
  {
    id: "tooru-amuro",
    name: "Tooru Amuro / Bourbon",
    aliases: ["Bourbon", "Rei Furuya"],
    role: "Triple agent: café waiter, detective, Organization operative",
    affiliation: "Public Security Bureau / Black Organization",
    bio: "A triple agent serving the Organization, the police, and the national security agencies at once. As café waiter 'Toru Amuro' and operative Bourbon, he guards a secret as layered as his code names.",
    x: 800,
    y: 340,
  },
  {
    id: "shuichi-akai",
    name: "Shuichi Akai",
    aliases: ["Rye", "Subaru Okiya"],
    role: "FBI agent on the Organization's trail",
    affiliation: "FBI",
    bio: "A crack FBI marksman and the man who destroyed Gin's roadblock plan. Akai was once Bourbon's target of obsession and is the presumed-dead brother of Masumi and the lost love of Akemi.",
    x: 700,
    y: 360,
  },
  {
    id: "akemi-miyano",
    name: "Akemi Miyano",
    role: "Shiho's sister and Akai's lost love",
    affiliation: "Black Organization (deceased)",
    bio: "Shiho's older sister, an Organization operative who tried to leave and paid with her life. Akemi's death drives both Shiho's defection and Akai's deep, unreconciled grief.",
    x: 790,
    y: 470,
  },
  {
    id: "james-black",
    name: "James Black",
    role: "Genial senior agent of the FBI",
    affiliation: "FBI",
    bio: "The calm, much-tested supervisor of the FBI's Japanese headquarters. James steadies the volatile Akai and Jodie while they close in on the Organization.",
    x: 660,
    y: 480,
  },
  {
    id: "jodie-starling",
    name: "Jodie Starling",
    role: "FBI agent and survivor of a past Organization crime",
    affiliation: "FBI",
    bio: "An FBI agent of Japanese descent hunting the Organization that killed her father. Jodie once posed as an English teacher in Beika, crossing paths with the cast before her true role surfaced.",
    x: 580,
    y: 400,
  },
  {
    id: "inspector-megure",
    name: "Inspector Juzo Megure",
    role: "The veteran detective who works with 'Sleeping Kogoro'",
    affiliation: "Tokyo Metropolitan Police",
    bio: "The grizzled, pipe-smoking homicide inspector of the Tokyo MPD. Megure is a constant at Conan's crime scenes, trusting Kogoro's 'intuition' while the child detective works unseen.",
    x: 420,
    y: 530,
  },
  {
    id: "officer-sato",
    name: "Officer Miwako Sato",
    role: "The MPD's toughest, most capable detective",
    affiliation: "Tokyo Metropolitan Police",
    bio: "A fearless MPD detective and Takagi's longtime partner and object of his devotion. Sato's skill, cool head, and romantic history with Takagi anchor the Tokyo crime squad.",
    x: 430,
    y: 580,
  },
  {
    id: "officer-takagi",
    name: "Officer Wataru Takagi",
    role: "Sato's earnest, accident-prone partner",
    affiliation: "Tokyo Metropolitan Police",
    bio: "An earnest, well-meaning MPD detective perpetually in Sato's orbit. Takagi's clumsy heroics and steadfast loyalty make him both the squad comic and its romantic heart.",
    x: 310,
    y: 560,
  },
  {
    id: "eri-kisaki",
    name: "Eri Kisaki",
    role: "Formidable lawyer and Kogoro's estranged wife",
    affiliation: "Kisaki Law Offices",
    bio: "A brilliant lawyer, Ran's mother, and Kogoro's long-separated wife. Eri's courtroom mastery repeatedly overlaps with Conan's cases, and her love for Kogoro never truly faded.",
    x: 140,
    y: 470,
  },
  {
    id: "yusaku-kudo",
    name: "Yusaku Kudo",
    role: "World-renowned mystery novelist and Shinichi's father",
    affiliation: "Kudo Family",
    bio: "The legendary mystery author whose deductions dwarf even his son's. Yusaku is one of the few adults Conan openly trusts with the Organization secret.",
    x: 190,
    y: 70,
  },
  {
    id: "yukiko-kudo",
    name: "Yukiko Kudo",
    role: "Retired actress and Shinichi's mother",
    affiliation: "Kudo Family",
    bio: "Shinichi's glamorous mother, a retired Hollywood-style actress trained in disguise arts. Yukiko loves impersonation and, alongside her husband, anchors Conan's greatest allies.",
    x: 90,
    y: 90,
  },
  {
    id: "mary-sera",
    name: "Mary Sera",
    role: "Shrunk British agent and the Sera matriarch",
    affiliation: "MI6 / Sera Family",
    bio: "The shrunk British intelligence agent who, like Conan and Haibara, was undone by APTX. Masumi's mother, she operates in secret as a mysterious child.",
    x: 640,
    y: 150,
  },
  {
    id: "masumi-sera",
    name: "Masumi Sera",
    role: "Sharp-eyed detective convinced Conan is Shinichi",
    affiliation: "Teitan High School",
    bio: "A perceptive high-school detective, Akai's sister, and Mary's daughter, who guessed Conan's identity. Masumi's outsider cleverness keeps her perpetually circling the truth.",
    x: 600,
    y: 260,
  },
  {
    id: "ginzo-nakamori",
    name: "Inspector Ginzo Nakamori",
    role: "The officer who swears he will catch Kaitou Kid",
    affiliation: "Tokyo Metropolitan Police",
    bio: "The explosive, prideful inspector of the division devoted to capturing Kaitou Kid. Nakamori loses heist after heist yet never stops swearing this time will be different.",
    x: 840,
    y: 120,
  },
]

/** Typed edges linking the cast (63 edges). */
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
