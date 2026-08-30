# DCPH-Tracker — System Documentation

> Complete technical reference for the Detective Conan PH community platform.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15.1 (App Router) |
| Language | TypeScript 5.7 |
| UI | React 19, Tailwind CSS 3.4 |
| Animation | Framer Motion 11 |
| Database | Supabase (PostgreSQL + PostgREST + RLS) |
| Auth | Supabase Auth (Brevo SMTP) |
| Hosting | Vercel (auto-deploy from `main`) |
| AI Chatbot | OpenRouter API (free tier) |
| Testing | Vitest |

---

## Frontend

### Core
- **Next.js 15** — App Router, Server Components, Server Actions, API Routes
- **React 19** — Client components marked with `"use client"`
- **TypeScript** — Strict mode, path aliases via `@/*`

### Styling
- **Tailwind CSS 3.4** — Utility-first CSS framework
- **tailwind-merge** — Deduplicates conflicting Tailwind classes (`cn()` utility)
- **tailwindcss-animate** — Animation utilities
- **class-variance-authority (CVA)** — Component variant management
- **clsx** — Conditional class joining

### UI Components
- **Radix UI** — Headless, accessible primitives:
  - `@radix-ui/react-dialog` — Modal dialogs
  - `@radix-ui/react-dropdown-menu` — Dropdown menus
  - `@radix-ui/react-select` — Select inputs
  - `@radix-ui/react-tabs` — Tab panels
  - `@radix-ui/react-tooltip` — Tooltips
  - `@radix-ui/react-avatar` — Avatar with fallback
  - `@radix-ui/react-separator` — Visual dividers
  - `@radix-ui/react-label` — Form labels
  - `@radix-ui/react-slot` — Polymorphic components

### Icons & Animation
- **Lucide React** — Icon library (500+ icons)
- **Framer Motion** — Page transitions, layout animations, scroll effects

### State Management
- **TanStack React Query** — Server state caching, optimistic updates, mutations

### Image Export
- **html-to-image** — Renders DOM nodes to PNG (used for the "Wrapped" shareable stat cards)

---

## Backend / API

### API Routes (`app/api/`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sync` | POST | Content sync from Jikan/Kitsu/AniList (cron + admin) |
| `/api/chat` | POST/DELETE | Community chat message send/unsend |
| `/api/ai-chat` | POST | AI chatbot (streams from OpenRouter) |
| `/api/dcw/episode` | GET | DCW wiki episode details |
| `/api/proxy-image` | GET | CORS-safe avatar proxy for canvas export |
| `/api/analytics` | GET | User analytics data |
| `/api/tracker` | GET | Tracker content entries |

### Server-Side Code
- **Supabase Server Client** — `createClient()` from `@/utils/supabase/server` (async, cookie-based)
- **Supabase Client** — `createClient()` from `@/utils/supabase/client` (sync, browser-based)
- **Rate Limiting** — In-memory per-IP + persistent DB-backed (`lib/rate-limit.ts`, `lib/rate-limit-db.ts`)
- **Profanity Filter** — `lib/profanity.ts` — redacts forbidden words from chat messages
- **Origin Check** — `lib/origin-check.ts` — same-origin verification for API routes

### Middleware
- **Auth middleware** — Refreshes Supabase session tokens
- **CSP nonce** — Content Security Policy with per-request nonces

---

## Database (Supabase)

### Project
- **URL**: `https://hgwtlbbbkxppbasbhvlo.supabase.co`
- **Tables**: 15+ tables with Row-Level Security (RLS)
- **Migrations**: Manual SQL in `supabase/` directory

### Core Tables

| Table | Purpose |
|-------|---------|
| `content_entries` | All episodes, movies, specials, OVAs (1200+ entries) |
| `watch_status` | User watch data per entry (watched/rewatched/unwatched, count, rating, favorite) |
| `profiles` | User profiles (username, display_name, avatar, role) |
| `arcs` | Story arcs with episode ranges |
| `dcw_cases` | Crime data from DCW wiki (victim, suspects, location, method) |
| `chat_messages` | Community chat messages |
| `chat_rooms` | Chat room definitions |
| `badges` | Achievement badges |
| `user_badges` | Earned badges per user |
| `watch_events` | Immutable watch log (feeds leaderboards) |
| `episode_comments` | Episode discussion threads |
| `notifications` | User notifications |
| `sync_staging` | Admin approval queue for synced content |
| `screening_events` | Movie screening event listings |

### SQL Views
- `all_episodes_with_crimes` — Joins `content_entries` with `dcw_cases`
- `public_profiles` — PII-safe profile subset for public display

---

## External APIs

### 1. Detective Conan World (DCW) Wiki
- **URL**: `https://www.detectiveconanworld.com/wiki/api.php`
- **Type**: MediaWiki 1.45 API (public, no key required)
- **Client**: `lib/dcw.ts` — `dcwQuery()` with throttling (200ms min interval), retries, backoff
- **Usage**:
  - Episode details (cast, gadgets, plot) — `lib/dcw-episode.ts`
  - Crime case data (victim, method, suspects) — `lib/dcw-cases.ts`
  - Title matching (tracker ↔ wiki) — `lib/dcw-match.ts`
  - Image fetching — `lib/dcw-image-for-title.ts`
  - Chatbot search — `lib/chat/search.ts`

### 2. Jikan API (MyAnimeList)
- **URL**: `https://api.jikan.moe/v4`
- **Type**: Free MAL API wrapper
- **Usage**: Fetches episode lists, anime details for content sync
- **Client**: `lib/jikan.ts` — rate-limited fetch with pagination

### 3. Kitsu API
- **URL**: `https://kitsu.io/api/edge`
- **Type**: Free anime database API
- **Usage**: Franchise entry data (movies, specials, OVAs) for content sync
- **Client**: `lib/kitsu.ts`

### 4. AniList API
- **URL**: `https://graphql.anilist.co`
- **Type**: GraphQL API
- **Usage**: Airing schedule data for content sync
- **Client**: `lib/anilist.ts`

### 5. OpenRouter API (AI Chatbot)
- **URL**: `https://openrouter.ai/api/v1/chat/completions`
- **Type**: OpenAI-compatible API gateway
- **Usage**: Powers the DCPH Bot chatbot with free models
- **Client**: `app/api/ai-chat/route.ts`
- **Models**: Free tier (`:free` suffix) — auto-routes to available free model
- **Keys**: Two API keys for failover (primary + backup)

### 6. UI Avatars (Fallback)
- **URL**: `https://ui-avatars.com/api/`
- **Usage**: Generates avatar placeholders from user initials
- **Client**: `lib/constants.ts` — `avatarUrl()`

---

## AI Chatbot (DCPH Bot)

### Architecture
```
User question
  → ChatWidget (floating button → slide-up panel)
    → POST /api/ai-chat
      → DCW Wiki search (MediaWiki API, multiple query variations)
      → Wikipedia search (fallback when DCW has few results)
      → Tracker DB search (content_entries + dcw_cases)
      → User watch history (if signed in)
      → Build system prompt with all context
      → OpenRouter API (free model, streaming)
      → Stream plain text response back
    → ChatWidget renders streaming text
```

### Data Sources (priority order)
1. **DCW Wiki** — Character pages, episode guides, trivia
2. **Wikipedia** — Broader coverage when DCW has little
3. **Tracker DB** — Your episode/movie catalog
4. **User watch history** — If signed in

### Search Strategies
- Full query search
- Character name + "movie"/"episode" suffixes
- Movie-specific queries
- Latest movie direct DB query (`ORDER BY air_date DESC`)

### Rate Limiting
- **App-level**: None (removed for testing)
- **OpenRouter**: ~20 req/min per API key, ~1000 req/day
- **Failover**: Two API keys — if first gets 429, automatically tries second

### Thinking Stripper
- Removes `<think>` blocks
- Strips leaked reasoning patterns ("Analyze User Input:", "Key elements:", etc.)
- Applied per-chunk during streaming

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://hgwtlbbbkxppbasbhvlo.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Cron sync
CRON_SECRET=...
ADMIN_TASK_SECRET=dcph123

# OpenRouter (AI Chatbot)
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_API_KEY_2=sk-or-v1-...
```

---

## Deployment

- **Platform**: Vercel
- **Auto-deploy**: `main` branch only
- **Cron jobs** (Vercel Cron):
  - `/api/sync?mode=airing` — daily
  - `/api/sync?mode=seed` — weekly
- **Branches**: `main` (production), `production` (mirror)

---

## Project Structure

```
DCPH-Tracker/
├── app/                    # Next.js App Router pages
│   ├── (app)/              # Authenticated routes
│   │   ├── tracker/        # Episode tracker
│   │   ├── cases/          # Case files archive
│   │   ├── characters/     # Character graph
│   │   ├── analytics/      # Personal stats
│   │   ├── wrapped/        # Shareable stat cards
│   │   ├── community/      # Chat + rankings
│   │   ├── profile/        # User profiles
│   │   └── admin/          # Admin dashboard
│   ├── api/                # API routes
│   └── layout.tsx          # Root layout (fonts, theme, providers)
├── components/             # React components
│   ├── ui/                 # Radix-based primitives (button, dialog, etc.)
│   ├── tracker/            # Episode grid, cards, detail modals
│   ├── wrapped/            # Shareable stat card components
│   ├── chat/               # AI chatbot components
│   ├── community/          # Chat, rankings, comments
│   ├── characters/         # Character graph visualization
│   ├── profile/            # Profile card, stats grid
│   └── layout/             # Navbar, footer
├── lib/                    # Shared utilities & logic
│   ├── chat/               # Chatbot search + prompt builder
│   ├── wrapped/            # Card export + character backgrounds
│   ├── queries/            # Supabase queries (server + client)
│   ├── dcw*.ts             # DCW wiki integration
│   ├── jikan.ts            # Jikan API client
│   ├── kitsu.ts            # Kitsu API client
│   └── constants.ts        # App-wide constants
├── utils/supabase/         # Supabase client setup (server + client)
├── types/                  # TypeScript type definitions
├── supabase/               # SQL migrations
└── public/                 # Static assets (character images, logos)
```

---

## Key Features Summary

| Feature | Tech |
|---------|------|
| Episode tracking | Supabase + React Query |
| Character graph | D3-like force-directed SVG (custom) |
| Community chat | Supabase Realtime + polling |
| AI chatbot | OpenRouter + DCW Wiki + Wikipedia |
| Shareable stat cards | html-to-image + character backgrounds |
| Crime archive | DCW wiki scraping + Supabase |
| Analytics | Supabase queries + client computation |
| Leaderboard | Watch events aggregation |
| Admin sync | Jikan/Kitsu/AniList → staging → approval |
