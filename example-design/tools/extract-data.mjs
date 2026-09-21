/*
  Generates example-design/lib/data.js from the app's own data modules, so the
  four design prototypes always render the real cast, the real relationships and
  the real portraits — never mock data.

  Run: node example-design/tools/extract-data.mjs
*/
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { execFileSync } from "node:child_process"

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, "..", "..")

// The guide module imports two sibling modules; strip those lines and evaluate
// the rest with node's type stripping so we read the authored data verbatim.
const src = readFileSync(join(root, "lib/characters-guide.ts"), "utf8")
const stripped = src
  .split("\n")
  .filter((l) => !l.includes("characters-spoiler") && !l.includes("characters-debut"))
  .join("\n")
const tmp = join(here, ".guide.tmp.ts")
writeFileSync(tmp, stripped)
const json = execFileSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "-e",
    `import(${JSON.stringify(tmp)}).then(m=>process.stdout.write(JSON.stringify({c:m.CHARACTERS,r:m.RELATIONSHIPS})))`,
  ],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
)

const { c: characters, r: relationships } = JSON.parse(json)

// Portrait filenames live in a hand-written map inside the guide module.
const imgBlock = src.slice(src.indexOf("const CHARACTER_IMAGES"), src.indexOf("};", src.indexOf("const CHARACTER_IMAGES")))
const images = {}
for (const line of imgBlock.split("\n")) {
  const m = line.match(/^\s*"?([a-z0-9-]+)"?:\s*"(.+?)",?\s*$/)
  if (m) images[m[1]] = m[2]
}
const available = new Set(readdirSync(join(root, "public/characters")))

/*
  Affiliation -> faction. The app resolves factions by substring match against a
  13-key table, which leaves 20+ authored affiliations (every regional police
  force, both Miyano parents, the CIA, the Sera family) falling through to a
  single "civilians" bucket. These prototypes are a design study for a better
  graph, so this table maps all 42 authored affiliations explicitly.
*/
const FACTIONS = {
  JDL:      { label: "Junior Detective League", short: "JDL",  hue: "#22D3EE" },
  KUDO:     { label: "Kudo Family",             short: "KUD",  hue: "#38BDF8" },
  OSAKA:    { label: "Osaka & Hattori",         short: "OSA",  hue: "#FB923C" },
  MOURI:    { label: "Mouri & Kisaki",          short: "MOR",  hue: "#2DD4BF" },
  SUZUKI:   { label: "Suzuki Family",           short: "SUZ",  hue: "#F472B6" },
  KID:      { label: "Kaitou Kid",              short: "KID",  hue: "#818CF8" },
  TMPD:     { label: "Tokyo Metropolitan PD",   short: "TMPD", hue: "#FBBF24" },
  POLICE:   { label: "Regional Police",         short: "RPD",  hue: "#D9A441" },
  PSB:      { label: "Public Security Bureau",  short: "PSB",  hue: "#C084FC" },
  FBI:      { label: "FBI",                     short: "FBI",  hue: "#A78BFA" },
  MI6:      { label: "MI6 & Sera Family",       short: "MI6",  hue: "#8B9CF7" },
  CIA:      { label: "CIA",                     short: "CIA",  hue: "#94A3B8" },
  BO:       { label: "Black Organization",      short: "B.O.", hue: "#F43F5E" },
  MIYANO:   { label: "Miyano Family",           short: "MIY",  hue: "#E879B9" },
  CIVILIAN: { label: "Civilians & Allies",      short: "CIV",  hue: "#60A5FA" },
}

const AFFILIATION_FACTION = {
  "Junior Detective League": "JDL",
  "Kudo Family": "KUDO",
  "Osaka / Hattori Household": "OSAKA",
  "Osaka Cast": "OSAKA",
  "Osaka Police": "OSAKA",
  "Hattori Family": "OSAKA",
  "Mouri Detective Agency": "MOURI",
  "Mouri Family": "MOURI",
  "Kisaki Law Offices": "MOURI",
  "Suzuki Family": "SUZUKI",
  "Suzuki Family / Martial Arts Cast": "SUZUKI",
  "Phantom Thief Kid": "KID",
  "Phantom Thief Cast": "KID",
  "Kaito Kid Legacy": "KID",
  "Tokyo Metropolitan Police": "TMPD",
  "Nagano Police": "POLICE",
  "Gunma Police": "POLICE",
  "Shizuoka Police": "POLICE",
  "Saitama Police": "POLICE",
  "Kyoto Police": "POLICE",
  "Regional Police": "POLICE",
  "Hokkaido Police": "POLICE",
  "Public Security Bureau": "PSB",
  "Public Security Bureau (deceased)": "PSB",
  "Public Security Bureau / Black Organization": "PSB",
  FBI: "FBI",
  "MI6 / Sera Family": "MI6",
  "Akai Family / MI6": "MI6",
  "Teitan High School": "MI6",
  "CIA / Black Organization": "CIA",
  "CIA Connection": "CIA",
  "Black Organization": "BO",
  "Black Organization (deceased)": "BO",
  "Miyano Family": "MIYANO",
  "Beika Inventor & Supporting Cast": "CIVILIAN",
  "Haneda Family": "CIVILIAN",
  Civilian: "CIVILIAN",
  "Media / Celebrity": "CIVILIAN",
  "Soccer World": "CIVILIAN",
  "Café Poirot": "CIVILIAN",
  "Nagoya Detectives": "CIVILIAN",
  "Teitan Elementary": "CIVILIAN",
}

const unresolved = [...new Set(characters.map((c) => c.affiliation))].filter((a) => !AFFILIATION_FACTION[a])
if (unresolved.length) throw new Error("Unmapped affiliations: " + unresolved.join(", "))

const payload = {
  world: { width: 2600, height: 1900 },
  hub: "conan-edogawa",
  factions: FACTIONS,
  nodes: characters.map((c) => ({
    id: c.id,
    name: c.name,
    label: c.name.split("/")[0].trim(),
    aliases: c.aliases ?? [],
    role: c.role,
    affiliation: c.affiliation,
    faction: AFFILIATION_FACTION[c.affiliation],
    bio: c.bio ?? "",
    img: images[c.id] && available.has(images[c.id]) ? images[c.id] : null,
    x: c.x,
    y: c.y,
  })),
  edges: relationships.map((r) => ({
    id: r.id,
    s: r.source,
    t: r.target,
    type: r.type,
    detail: r.detail ?? "",
  })),
}

writeFileSync(
  join(here, "..", "lib", "data.js"),
  "/* GENERATED by example-design/tools/extract-data.mjs — do not edit by hand. */\n" +
    "window.DCPH_DATA = " +
    JSON.stringify(payload) +
    ";\n",
)
console.log(
  `wrote example-design/lib/data.js — ${payload.nodes.length} nodes, ${payload.edges.length} edges, ` +
    `${payload.nodes.filter((n) => n.img).length} portraits, ${Object.keys(FACTIONS).length} factions`,
)
