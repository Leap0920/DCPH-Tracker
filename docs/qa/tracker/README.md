# Tracker QA — layout, tabs, canon labels, runtime, bulk rewatch

What was checked on `/tracker`, on `feat/tracker-redesign`, with the commands
that re-run each check.

**The PNGs are not in version control.** `.gitignore` excludes `/docs/**/*.png`
(and jpg/jpeg/webp), because a QA folder is 100+ captures per feature and they
die with the browser session. This file — the written record — is deliberately
*not* ignored. Regenerate the shots locally with the recipe below when you need
to look at one.

The page needs a signed-in session, so captures come from `/preview-tracker`,
which mounts the same `ContentGrid` (rails, `PosterCard`, `TrackerToolbar`,
`EpisodeTools`, `TrackerRow`) against a fixture catalogue in the production page
shell. The only differences are the data source and the absence of the dashboard
cards above it.

## What each shot looks at

| Shot | What it checks |
| --- | --- |
| `01-page-top.png` | The page opens on the list card: Continue-watching rail, the category tab row, one control bar, all inside a bordered panel. Every element — rail heading, first card, tab, search field, tools label, episode row — starts on the same left gutter. |
| `02-toolbar-and-tools.png` | Search and Order/Status/Tag share one bar with hairline dividers; the fields inside are borderless. Below, one episode number and three verbs: `Go`, `Mark 12`, `Rewatch 12`. |
| `03-bulk-rewatch-applied.png` | Two presses of `Rewatch 12`: every row in range carries a rewatch badge — `2` across EP 001–012, `4` on EP 003 (fixture count 2). One upsert, not twelve. |
| `04-runtime-episodes.png` | Runtime in its own right-aligned column: `25m` standard, `46m` on EP 011, next to the canon verdict. No duplicate length chip. |
| `05-runtime-movies.png` | Same column on the Movie tab, where a feature reads `1h 35m` rather than `95m`. |
| `06-mobile.png` | 390 px: rails peek, tabs scroll, filters stack, tools wrap one field per line, no horizontal overflow. |

## Tab row

Each tab is one line of `index + label`, then one line of `watched/total` plus a
small progress hairline. The active tab gets a surface pill, semibold ink, and a
full-width underline on the rail baseline. Short labels (`Live action`,
`Hanzawa`, `Zero's Tea`) keep all eight categories on one row at desktop width;
the full name stays on `title` and `aria-label`.

## Two bugs this pass fixed

**`1218 / 1216` on the Episode tab.** `buildTypeTabs` counted whatever rows it
was handed, and `fetchAllContentEntries` paged with `OFFSET` while ordering only
by `air_date` — not a unique column. Rows sharing a date can come back in a
different order per page request, so one page can repeat a row another page also
returns. The fetch now orders by `(air_date, id)`, the tab builder dedupes by id
and clamps `watched` to `total`, and two tests pin both.

**A 56 px left gap.** Rails, tabs, search and tools used `lg:px-14` (56 px) while
the rows below used `sm:px-5` (20 px), so everything above the list started 36 px
further right than the list itself. All of them now share `px-3 sm:px-5`, and the
page shell stays the centred `max-w-7xl` container it always was.

## Not in the build

`components/tracker/TrackerHero.tsx` is the full-bleed billboard from an earlier
pass. It is parked, not mounted, and documented as such in the file: the tracker
opens on your progress and the list. Kept so a compact banner can be built from it
without starting over.

## Reproducing

```bash
# one dev server, Windows side
npx next dev -p 3000

# capture (driver lives in .perch/, which is gitignored)
node .perch/cdp.mjs --url http://localhost:3000/preview-tracker \
  --out C:\codes\DCPH-Tracker\.perch\shots\shot.png \
  --width 1440 --height 900 --wait 8000
```

`--eval "<expr>"` runs against the loaded page; `--text "<value>" --textTarget
"<selector>"` types into a control through CDP `Input.insertText`, which is the
only path React's `onChange` accepts in this setup.

## Checks behind these shots

- `tsc -p tsconfig.json --noEmit` — clean
- `eslint components/tracker lib/... --max-warnings=0` — clean
- `vitest run lib/__tests__ components/tracker/__tests__` — **641 tests pass**,
  including `formatHours`, `countUnwatchedUpTo`, `countRewatchableUpTo`, and the
  two new tab-count regression tests
- Layout probes: page mounts at `scrollY 0`; rail heading, first card, first tab,
  search field, tools label and first row all measured at the same x; no
  horizontal overflow at 390 px or 1566 px
