# Pure Darkness Theme + Cinematic Homepage

## TL;DR

> **Quick Summary**: Deepen the entire palette to near-absolute black with poison-red as the only real color, then rebuild the homepage to showcase the tracker with cinematic Framer Motion animations — floating dossier cards, staggered reveals, and a dramatic hero.
> 
> **Deliverables**:
> - Updated tailwind.config.ts with pure darkness palette
> - Upgraded globals.css with deeper body, grain overlay, refined shadows
> - Complete HeroSection rewrite with cinematic animations + tracker card preview
> - Enhanced FeaturesSection with dramatic stagger + darker cards
> - Restructured app/page.tsx homepage flow
> - Darkened Navbar + Footer
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Theme tokens → Homepage components → Build check

---

## Context

### Original Request
User wants: "pure darkness" theme and a homepage that "introduces the look of the tracker" with beautiful UI/UX and nice animations.

### Current State
- All 11 routes built and passing `next build`
- Tailwind config has Black Organization palette but colors aren't dark ENOUGH — `noir-black` is `#0B0B0D` (not void-black), `dossier-cream` is `#E9E4D8` (too bright/white)
- Homepage (app/page.tsx) is functional but generic — stacks Hero → Features → Screening → Social with basic fade-in animations
- HeroSection shows text + stats but doesn't SHOW the tracker at all
- No Framer Motion layout animations, no stagger, no parallax, no depth

### Design Direction
- **Palette**: Push toward void-black (`#040406` base). All grays become much more muted. Only poison-red provides color. Near-monochrome.
- **Homepage**: The hero should visually introduce the TRACKER — show floating dossier cards as a preview. User should immediately see what the app does, not just read about it.
- **Animations**: Cinematic feel — fade-in-up reveals, staggered card entrances, subtle parallax/glow effects, pulse animations on red accents.

---

## Work Objectives

### Core Objective
Transform the visual identity from "dark theme" to "pure void darkness" and make the homepage a cinematic showcase of the tracker.

### Concrete Deliverables
- `tailwind.config.ts` — new pure darkness palette
- `app/globals.css` — darker body, refined grain, deeper shadows
- `components/marketing/HeroSection.tsx` — cinematic hero with floating tracker card previews
- `components/marketing/FeaturesSection.tsx` — dramatic stagger animations
- `app/page.tsx` — restructured homepage flow
- `components/layout/Navbar.tsx` — darker, seamless
- `components/layout/Footer.tsx` — darker, match theme

### Must Have
- Near-absolute black base (`#040406` or darker)
- Poison-red as the ONLY vibrant color — everything else monochrome
- Hero shows actual tracker card previews (mock dossier cards floating/animating in)
- Staggered Framer Motion animations on all sections
- Smooth scroll transitions between sections

### Must NOT Have (Guardrails)
- No bright whites — dossier-cream should be warm but subdued (`#C8C3B6` max)
- No new color additions — stay within the monochrome + red palette
- No changes to routes, database queries, auth, or data logic
- No new npm packages — use only existing framer-motion, lucide-react, tailwind
- No changes to components outside the homepage path (tracker components stay as-is)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO (no test framework configured)
- **Automated tests**: None
- **Framework**: None

### QA Policy
Agent runs `npm run build` and verifies zero errors. Visual verification via build output size comparison.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — theme tokens):
├── Task 1: tailwind.config.ts — pure darkness palette [quick]
├── Task 2: globals.css — deeper body, grain, shadows [quick]
└── Task 3: Navbar + Footer — darken [quick]

Wave 2 (Homepage — depends on Wave 1):
├── Task 4: HeroSection — cinematic rewrite with tracker preview [visual-engineering]
├── Task 5: FeaturesSection — dramatic stagger animations [visual-engineering]
└── Task 6: app/page.tsx — restructured flow [quick]

Wave FINAL (After ALL tasks):
└── Task F1: Build check — npm run build, verify 0 errors [quick]
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 (tailwind) | — | 2, 3, 4, 5, 6 |
| 2 (globals.css) | 1 | 4, 5, 6 |
| 3 (Navbar/Footer) | 1 | F1 |
| 4 (HeroSection) | 1, 2 | F1 |
| 5 (FeaturesSection) | 1, 2 | F1 |
| 6 (page.tsx) | 4, 5 | F1 |
| F1 (Build) | ALL | — |

### Agent Dispatch Summary
- **Wave 1**: 3 tasks → `quick` (tailwind, globals.css, navbar/footer)
- **Wave 2**: 3 tasks → `visual-engineering` (hero, features) + `quick` (page.tsx)
- **FINAL**: 1 task → `quick` (build check)

---

## TODOs

- [ ] 1. tailwind.config.ts — Pure Darkness Palette

  **What to do**:
  - Replace ALL color values with the new pure darkness palette:
    - `noir-black`: `#040406` (void — near-absolute black)
    - `noir-surface`: `#0A0A0E` (slightly lifted — sections, depth)
    - `case-file`: `#0F1014` (card/panel — barely visible)
    - `case-file-raised`: `#16171D` (elevated — hover, modals)
    - `case-file-border`: `#1C1D24` (subtle border — barely there)
    - `poison-red`: `#6B1018` (deep blood)
    - `poison-red-bright`: `#9A1822` (vivid blood — hover/active)
    - `poison-red-glow`: `#9A182240` (glow/shadow)
    - `silver-steel`: `#6B6E75` (very muted)
    - `dossier-cream`: `#C8C3B6` (warm but subdued)
    - `dossier-cream-dim`: `#7A766D` (muted text)
    - `gold-seal`: `#8A6A22` (rare accent)
    - `redacted`: `#080809` (blackout)
  - Add `noir-surface` and `case-file-border` to the colors (new tokens)
  - Update boxShadow to use deeper blacks: `dossier`, `dossier-hover`, `dossier-glow`
  - Add keyframes: `fade-in-up`, `fade-in`, `slide-in-left`, `pulse-glow`
  - Add corresponding animation utilities

  **Must NOT do**:
  - Don't change font families, content paths, or plugin config
  - Don't add new colors beyond what's specified

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 2, 3, 4, 5, 6
  - **Blocked By**: None

  **References**:
  - `tailwind.config.ts` — current file to modify (entire overwrite)

  **Acceptance Criteria**:
  - [ ] `npm run build` still passes (no compile errors from new tokens)
  - [ ] All new color tokens are defined
  - [ ] New keyframes and animations are defined

  **QA Scenarios**:
  ```
  Scenario: Build passes with new tailwind config
    Tool: Bash
    Steps:
      1. cd C:\codes\DCPH-Tracker
      2. npm run build
    Expected Result: Build succeeds with 0 errors
    Evidence: .sisyphus/evidence/task-1-build.txt
  ```

  **Commit**: YES
  - Message: `feat(theme): pure darkness palette`
  - Files: `tailwind.config.ts`

---

- [ ] 2. globals.css — Darker Body + Grain + Shadows

  **What to do**:
  - Update `body` styles:
    - Change `bg-noir-black` to use the new `#040406` base (it references the tailwind token so just verify)
    - Remove the subtle radial gradients (too light for pure darkness) — replace with a single very faint red glow at top
    - Add a CSS grain/noise overlay using a `::after` pseudo-element on body for texture depth (use a tiny inline SVG noise pattern or CSS gradient-based noise)
  - Update `.dossier-card`:
    - Use `bg-case-file border border-case-file-border` (the new subtle border token)
    - Remove the `border-white/5` — use the new token instead
    - Make the `::before` red stripe slightly wider (4px) and use `bg-poison-red-bright` for more pop
  - Update `.dossier-stamp`:
    - Slightly more visible: `border-poison-red/40` instead of `/60`, keep text subdued
  - Update `.redacted-bar`:
    - Use `bg-redacted` (should already work, just verify)
  - Update `::selection`:
    - `bg-poison-red text-dossier-cream` (keep as-is, verify it works with new tokens)

  **Must NOT do**:
  - Don't add any external image dependencies for grain (use CSS-only)
  - Don't change font references

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 1, 3 — but Task 1 defines the tokens, so in practice run after Task 1)
  - **Parallel Group**: Wave 1 (technically sequential after Task 1)
  - **Blocks**: Tasks 4, 5, 6
  - **Blocked By**: Task 1

  **References**:
  - `app/globals.css` — current file to modify
  - CSS grain technique: Use `background-image: url("data:image/svg+xml,...")` with a tiny feTurbulence SVG for noise

  **Acceptance Criteria**:
  - [ ] Body background is the new near-absolute black
  - [ ] Grain/noise overlay is visible (subtle texture)
  - [ ] Dossier cards have the new darker surface + border
  - [ ] `npm run build` passes

  **QA Scenarios**:
  ```
  Scenario: Build passes with new globals
    Tool: Bash
    Steps:
      1. cd C:\codes\DCPH-Tracker
      2. npm run build
    Expected Result: Build succeeds
    Evidence: .sisyphus/evidence/task-2-build.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(theme): darker globals + grain overlay`
  - Files: `app/globals.css`

---

- [ ] 3. Navbar + Footer — Darken

  **What to do**:
  
  **Navbar.tsx**:
  - Change `bg-noir-black/80` to `bg-noir-black/90` (more opaque, less bleed)
  - Change `border-white/5` to `border-case-file-border` (use new token)
  - Mobile nav: same border change
  - Logo box: `bg-poison-red` stays, but add subtle `shadow-lg shadow-poison-red/10`
  - Active nav link: `bg-case-file-raised` stays (already darker with new tokens)
  - Sign In button outline: make border more subtle — `border-silver-steel/30`

  **Footer.tsx**:
  - Change `border-white/5` to `border-case-file-border` (both dividers)
  - Change `border-white/10` on social icons to `border-case-file-border`
  - Social icon hover: `hover:border-poison-red/40` → `hover:border-poison-red/30` (more subtle)
  - Logo box: same subtle red shadow as navbar

  **Must NOT do**:
  - Don't change navigation links, routes, or structure
  - Don't change mobile hamburger logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 1, 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: F1
  - **Blocked By**: Task 1

  **References**:
  - `components/layout/Navbar.tsx` — current file (lines 16, 77)
  - `components/layout/Footer.tsx` — current file (lines 20, 70, 80)

  **Acceptance Criteria**:
  - [ ] Navbar uses new border tokens, more opaque background
  - [ ] Footer uses new border tokens
  - [ ] `npm run build` passes

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. cd C:\codes\DCPH-Tracker
      2. npm run build
    Expected Result: Build succeeds
    Evidence: .sisyphus/evidence/task-3-build.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(theme): darken navbar + footer borders`
  - Files: `components/layout/Navbar.tsx`, `components/layout/Footer.tsx`

---

- [ ] 4. HeroSection — Cinematic Rewrite with Tracker Preview

  **What to do**:
  Complete rewrite of `components/marketing/HeroSection.tsx`. This is the centerpiece.

  **Layout**:
  - Full-viewport hero (`min-h-[90vh]`) with centered content
  - Two-column on desktop: left = text + CTA, right = floating tracker card preview
  - Single column on mobile (text on top, cards below)

  **Left side (text)**:
  - `case-number` tag: "CLASSIFIED — LEVEL 5 CLEARANCE" (keep, add fade-in delay)
  - Main title: "Detective Conan PH" with the "PH" in poison-red-bright
  - Subtitle: "The Filipino community's case tracker. Log every episode, movie, and special."
  - Two CTAs: "Open Case Files" (filled red) + "View Rankings" (outline)
  - Stats row below CTAs: "1100+ Episodes · 29 Movies · 50+ Specials" in mono font

  **Right side (tracker card preview)**:
  - A stack of 3 dossier cards at slight angles (rotated -3deg, 0deg, 3deg) with subtle parallax
  - Cards should look like actual ContentCard components (no images — use placeholder with case numbers)
  - Each card has: the red left stripe, a stamp (EP 001, MOV 01, OVA), a title, a badge
  - Cards animate in with stagger (0.2s delay between each) from right + fade
  - Subtle floating animation on the cards (translateY oscillation, 3s loop)

  **Animations (Framer Motion)**:
  - Hero content: `initial={{ opacity: 0, y: 30 }}` → `animate={{ opacity: 1, y: 0 }}` with 0.8s duration
  - Stagger children with `staggerChildren: 0.15` in a parent `motion.div`
  - Cards: `initial={{ opacity: 0, x: 60, rotate: 0 }}` → `animate` with stagger
  - Stats: fade-in with delay 0.6s
  - Background: A very subtle radial glow — `bg-poison-red/5` blurred circle, with `animate-pulse-glow`

  **Background**:
  - Remove the current blur glow — replace with:
    - A faint grid pattern using CSS (repeating linear gradients forming a subtle grid)
    - A single radial gradient from top-center: very faint red (`poison-red/5`) fading to transparent
    - The grain overlay from globals.css will handle texture

  **Must NOT do**:
  - Don't use any images — all placeholder cards should be CSS-only
  - Don't import any new packages
  - Don't use `useState` for animation — purely declarative Framer Motion

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: This is a complex visual component with precise animation choreography and layout
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 5)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 6
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `components/marketing/HeroSection.tsx` — current file to completely rewrite
  - `components/tracker/ContentCard.tsx` — design reference for the floating preview cards (replicate the visual style: red stripe, stamp, badge, title)
  - `components/ui/badge.tsx` — Badge component for card type labels
  - `lib/utils.ts:padNumber()` — use for EP/MOV numbers
  - Framer Motion docs: `motion.div`, `staggerChildren`, `whileInView`, viewport options

  **Acceptance Criteria**:
  - [ ] Hero fills ~90vh
  - [ ] Left side has title, subtitle, CTAs, stats
  - [ ] Right side has 3 floating dossier cards at different angles
  - [ ] Cards animate in with stagger on page load
  - [ ] Cards have subtle floating animation (Y oscillation)
  - [ ] Background has subtle red glow + grid pattern
  - [ ] Responsive: stacks on mobile
  - [ ] `npm run build` passes

  **QA Scenarios**:
  ```
  Scenario: Build passes with new hero
    Tool: Bash
    Steps:
      1. cd C:\codes\DCPH-Tracker
      2. npm run build
    Expected Result: Build succeeds, HeroSection chunk size reasonable (<20kB)
    Evidence: .sisyphus/evidence/task-4-build.txt

  Scenario: Component renders without errors
    Tool: Bash
    Steps:
      1. grep for "use client" in HeroSection.tsx
      2. grep for "motion" imports from framer-motion
      3. Verify export function HeroSection exists
    Expected Result: All three checks pass
    Evidence: .sisyphus/evidence/task-4-lint.txt
  ```

  **Commit**: YES
  - Message: `feat(homepage): cinematic hero with tracker preview`
  - Files: `components/marketing/HeroSection.tsx`

---

- [ ] 5. FeaturesSection — Dramatic Stagger + Darker Cards

  **What to do**:
  Upgrade `components/marketing/FeaturesSection.tsx` with more dramatic animations and darker feel.

  **Changes**:
  - Section padding: increase vertical spacing for drama (`py-24` → `py-32`)
  - Section header: Add `motion.div` with `initial={{ opacity: 0, x: -20 }}` → `whileInView`
  - Cards:
    - Use `whileInView={{ opacity: 1, y: 0 }}` with `viewport={{ once: true, margin: "-100px" }}`
    - Add `whileHover={{ y: -4, transition: { duration: 0.2 } }}` for subtle lift on hover
    - Stagger: `staggerChildren: 0.12` in parent container
  - Each card:
    - Icon: Add subtle `group-hover:scale-110 transition-transform` on the icon
    - Red stripe on left is already from `.dossier-card` — verify it's visible on new darker palette
    - Stamp: rotate-6 stays, make border more subtle with `border-poison-red/20`
  - Background: Add a very faint horizontal line divider between sections using `border-case-file-border`
  - Add a `motion.div` wrapper around the whole section header with `line-through` style redacted bar animation

  **Must NOT do**:
  - Don't change the feature data (titles, descriptions, file numbers)
  - Don't add new features
  - Don't change the 2-column grid layout

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Animation choreography and visual refinement
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 4)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 6
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `components/marketing/FeaturesSection.tsx` — current file to modify
  - Framer Motion: `whileInView`, `staggerChildren`, `whileHover`

  **Acceptance Criteria**:
  - [ ] Cards animate in with stagger when scrolled into view
  - [ ] Cards lift slightly on hover
  - [ ] Icons scale on hover
  - [ ] Section has more vertical breathing room
  - [ ] `npm run build` passes

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. cd C:\codes\DCPH-Tracker
      2. npm run build
    Expected Result: Build succeeds
    Evidence: .sisyphus/evidence/task-5-build.txt
  ```

  **Commit**: YES
  - Message: `feat(homepage): dramatic feature card animations`
  - Files: `components/marketing/FeaturesSection.tsx`

---

- [ ] 6. app/page.tsx — Restructured Homepage Flow

  **What to do**:
  Restructure `app/page.tsx` for better visual flow and spacing.

  **Changes**:
  - Wrap everything in a `div` with `bg-noir-black` (ensure it uses the new pure black)
  - Remove `<Navbar />` and `<Footer />` from this page — they're rendered by the auth layout. Wait — check: the root `app/page.tsx` does NOT have a layout that includes Navbar/Footer. The `(auth)` group has its own layout. So we DO need Navbar + Footer here.
  - Keep Navbar + Footer
  - Add section dividers between major sections — thin `border-case-file-border` horizontal lines
  - After HeroSection, add a smooth transition section with a brief "HOW IT WORKS" or just keep it clean
  - Reorder to: Hero → Features → Screening Banner → Social → Footer
  - Add `motion.div` wrapper around `<main>` with `initial={{ opacity: 0 }}` → `animate={{ opacity: 1 }}` for page-level fade-in
  - Add `scroll-smooth` to the page wrapper for smooth anchor scrolling

  **Must NOT do**:
  - Don't add new sections beyond what exists
  - Don't change the order significantly (keep Hero first, Footer last)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (but after Tasks 4, 5)
  - **Blocks**: F1
  - **Blocked By**: Tasks 4, 5

  **References**:
  - `app/page.tsx` — current file to modify

  **Acceptance Criteria**:
  - [ ] Page has smooth scroll behavior
  - [ ] Page fades in on load
  - [ ] Sections have clear visual separation
  - [ ] `npm run build` passes

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. cd C:\codes\DCPH-Tracker
      2. npm run build
    Expected Result: Build succeeds
    Evidence: .sisyphus/evidence/task-6-build.txt
  ```

  **Commit**: YES
  - Message: `feat(homepage): restructured flow with smooth transitions`
  - Files: `app/page.tsx`

---

- [ ] F1. Build Check — Verify Everything

  **What to do**:
  - Run `npm run build` and verify 0 errors
  - Check build output for all routes
  - Verify no TypeScript errors in any component

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Blocked By**: ALL previous tasks
  - **Blocks**: None

  **Acceptance Criteria**:
  - [ ] `npm run build` exits with code 0
  - [ ] All routes compile (same 11 routes as before)
  - [ ] No new TypeScript errors

  **QA Scenarios**:
  ```
  Scenario: Clean build
    Tool: Bash
    Steps:
      1. cd C:\codes\DCPH-Tracker
      2. npm run build 2>&1
      3. Check exit code is 0
      4. Count route lines in output — should be 11 routes
    Expected Result: Build succeeds, 11 routes, 0 errors
    Evidence: .sisyphus/evidence/task-F1-build.txt
  ```

---

## Commit Strategy

- Tasks 1-2: `feat(theme): pure darkness palette + darker globals` — tailwind.config.ts, globals.css
- Task 3: `feat(theme): darken navbar + footer` — Navbar.tsx, Footer.tsx
- Tasks 4-6: `feat(homepage): cinematic hero + tracker preview` — HeroSection.tsx, FeaturesSection.tsx, page.tsx
- Task F1: No commit (verification only)

---

## Success Criteria

### Verification Commands
```bash
npm run build  # Expected: succeeds with 0 errors, 11 routes
```

### Final Checklist
- [ ] Palette is near-monochrome (only red provides color)
- [ ] Homepage hero shows tracker card previews
- [ ] All sections have Framer Motion animations
- [ ] No TypeScript errors
- [ ] No new dependencies added
- [ ] All existing routes still compile
