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
| Auth | Supabase Auth (Brevo SMTP & OTP Verification) |
| Hosting | Vercel (auto-deploy from `main`) |
| AI Chatbot | Multi-Provider Failover (Google Gemini, Groq Cloud, OpenRouter) |
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
- **html-to-image** — Renders DOM nodes to PNG (used for the "Wrapped" shareable stat cards with `dcphtracker.vercel.app/{username}` footer)

---

## Backend / API

### API Routes (`app/api/`)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/sync` | POST | Content sync from Jikan/Kitsu/AniList (cron + admin) |
| `/api/chat` | POST/DELETE | Community chat message send/unsend (permanent retention) |
| `/api/ai-chat` | POST | AI chatbot with RAG + multi-provider failover chain (Auth required) |
| `/api/auth/otp` | POST | Custom OTP email delivery via Brevo SMTP |
| `/api/dcw/episode` | GET | DCW wiki episode details |
| `/api/proxy-image` | GET | CORS-safe avatar proxy for canvas export |
| `/api/analytics` | GET | User analytics data |
| `/api/tracker` | GET | Tracker content entries |

### Server-Side Code
- **Supabase Server Client** — `createClient()` from `@/utils/supabase/server` (async, cookie-based)
- **Supabase Client** — `createClient()` from `@/utils/supabase/client` (sync, browser-based)
- **Supabase Admin Client** — `createAdminClient()` from `@/utils/supabase/admin` (bypasses RLS with service role)
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
- **Migrations**: SQL files in `supabase/` directory

### Core Tables

| Table | Purpose |
|-------|---------|
| `content_entries` | All episodes, movies, specials, OVAs (1200+ entries) |
| `watch_status` | User watch data per entry (watched/rewatched/unwatched, count, rating, favorite) |
| `profiles` | User profiles (username/handle, display_name, avatar_url, bio, role) |
| `arcs` | Story arcs with episode ranges |
| `dcw_cases` | Crime data from DCW wiki (victim, suspects, location, method) |
| `chat_messages` | Community chat messages (permanently retained) |
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
- `public_profiles` — PII-safe profile subset (`user_id`, `username`, `display_name`, `avatar_url`, `bio`)

### Key SQL Migrations (`supabase/`)
- `migration-public-profiles-bio.sql` — includes `bio` in `public_profiles` view
- `migration-remove-chat-purge.sql` — removes automatic 12-hour chat purge
- `migration-chat-realtime.sql` — adds `chat_messages` to Supabase Realtime publication
- `migration-sync-staging.sql` — admin approval staging queue
- `migration-episode-comments.sql` — episode comment threads and policies
- `migration-leaderboard-rls.sql` — row-level security for leaderboard reads
- `migration-enforce-bans.sql` — enforces account bans at the database layer

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

### 2. Google AI Studio (Gemini API)
- **URL**: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- **Type**: OpenAI-compatible Google Gemini API
- **Models**: `gemini-3.5-flash-lite` (500 req/day), `gemini-3.1-flash-lite` (500 req/day), `gemini-3.6-flash`
- **Role**: Primary intelligence tier in AI chatbot fallback chain

### 3. Groq Cloud API
- **URL**: `https://api.groq.com/openai/v1/chat/completions`
- **Type**: OpenAI-compatible ultra-fast LPU inference
- **Models**: `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `qwen/qwen3.6-27b`, `openai/gpt-oss-20b`, `groq/compound`
- **Role**: Secondary high-volume tier (~11,500 free req/day)

### 4. OpenRouter API
- **URL**: `https://openrouter.ai/api/v1/chat/completions`
- **Type**: Multi-model aggregator
- **Role**: Tertiary backup tier with primary + secondary key failover

### 5. Jikan API (MyAnimeList)
- **URL**: `https://api.jikan.moe/v4`
- **Type**: Free MAL API wrapper
- **Usage**: Fetches episode lists, anime details for content sync

### 6. Kitsu API
- **URL**: `https://kitsu.io/api/edge`
- **Type**: Free anime database API
- **Usage**: Franchise entry data (movies, specials, OVAs) for content sync

### 7. AniList API
- **URL**: `https://graphql.anilist.co`
- **Type**: GraphQL API
- **Usage**: Airing schedule data for content sync

---

## AI Chatbot (DCPH Bot)

### Architecture
```
User question (Signed-in member)
  → ChatWidget (floating launcher → slide-up panel)
    → POST /api/ai-chat (Auth verified)
      → DCW Wiki search (MediaWiki API, multiple query variations)
      → Wikipedia search (fallback when DCW has few results)
      → Tracker DB search (content_entries + dcw_cases)
      → User watch history & profile (if signed in)
      → Build system prompt (Tagalog/English natural tone + structured episode cards)
      → Multi-provider fallback stream:
          1. Google Gemini Flash Lite
          2. Groq Cloud LPU
          3. OpenRouter Free Models
      → Stream plain text response back
    → ChatWidget renders streaming markdown
```

### Key Chatbot Features
1. **Member-Only Access Gating**: Unauthenticated visitors see a friendly lock card with a one-click "Sign In to Chat" button triggering Supabase Auth modal. Server returns 401 Unauthorized for anonymous calls.
2. **Interactive Suggestion Chips**: Quick-action prompt chips (`What should I watch next?`, `Manga Canon Guide`, `Agasa's Gadgets`, `Movies vs Episodes`) powered by Lucide icons.
3. **Session Persistence**: Active conversations are stored in `sessionStorage` (`dcph_chat_history_v1`) so chats survive page transitions across `/tracker`, `/cases`, `/profile`, etc.
4. **Voice Input (Speech-to-Text)**: Native browser Web Speech API microphone button with audio recording animation.
5. **One-Click Message Copying**: Copy button with checkmark feedback under bot messages.
6. **Rich Interactive Tracker Links**: Episode/case links are styled as interactive badges linking to `https://dcphtracker.vercel.app/tracker/...`.
7. **Thinking Filter**: Strips reasoning/`<think>` blocks and internal thoughts during streaming.

---

## Profile & Rankings System

### Profile Dossier (`/profile/[username]`)
- **Detective Career Rank Badge**: Level 1 (Civilian Observer) to Level 7 (Master Detective) calculated from `casesSolved`.
- **Public Bio**: Displays user's custom bio with whitespace formatting.
- **Editable Codename (`@username`)**: Users can customize their unique `@username` handle in Settings with real-time validation and collision checks.
- **Career Stats Grid**:
  - Cases Solved (with catalog total)
  - Total Rewatches
  - Hours Watched (days/hours/minutes)
  - Detective Rank Level (clickable link to `/community/rankings`)

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://hgwtlbbbkxppbasbhvlo.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=https://dcphtracker.vercel.app

# Cron sync
CRON_SECRET=...
ADMIN_TASK_SECRET=dcph123

# AI Chatbot Providers
GEMINI_API_KEY=AQ.Ab...
GROQ_API_KEY=gsk_...
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_API_KEY_2=sk-or-v1-...
CEREBRAS_API_KEY=csk-...
CLOUDFLARE_API_TOKEN=cfut_...
```

---

## Deployment

- **Platform**: Vercel
- **Auto-deploy**: `main` branch
- **Cron jobs** (Vercel Cron):
  - `/api/sync?mode=airing` — daily
  - `/api/sync?mode=seed` — weekly
- **Production URL**: `https://dcphtracker.vercel.app`

