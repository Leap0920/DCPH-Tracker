# Detective Conan PH

The Filipino Detective Conan community — track episodes, join discussions, and prove your rank.

## Features

- **Track Episodes** — Log every case you watch — episodes, movies, specials and more
- **Story Arcs** — Follow the main plot from Season 1 to the latest era
- **Detective Rankings** — See how many episodes and how many minutes fellow detectives have cracked
- **Community Chat** — Themed rooms with live updates, unsend for your own messages, and a profanity filter; messages auto-clear after 12 hours
- **Episode Comments** — Discuss individual cases; filtered, rate-limited, and deletable with an in-app confirmation
- **Wiki Details** — Episode descriptions, cast and gadgets pulled live from Detective Conan World
- **Auth** — Sign in, register, forgot password, and OAuth callback
- **Analytics** — Personal watch stats and progress tracking
- **Admin** — Dashboard, content editor, and an approval queue for synced entries

## Setup

### Prerequisites

- Node.js 18+
- Supabase project (with RLS enabled)

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env.local` file with the following:

```
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CRON_SECRET=your-cron-secret
```

`SUPABASE_SERVICE_ROLE_KEY` is required for the admin sync approval actions — without it they return "Service role key not configured." `CRON_SECRET` authenticates the scheduled sync jobs.

### Email (SMTP)

Brevo is configured as the custom SMTP provider in Supabase Auth settings, and handles verification codes and password resets. No app-side configuration.

### Run

```bash
npm run dev
```

## Database

Run `supabase/schema.sql` in the Supabase SQL Editor first to create all tables.

### Migrations

Migrations live in `supabase/` and are run by hand in the Dashboard SQL Editor, in order of need — each one is independent, so apply only what your database is missing. Read the header comments before running; several include pre-flight and verification queries.

- `migration-sync-staging.sql` — `sync_staging` table backing the admin approval queue
- `migration-episode-comments.sql` — episode comment threads and policies
- `migration-notifications.sql` — notifications table and policies
- `migration-rate-limits.sql` — counters used by the rate-limited API routes
- `migration-leaderboard-rls.sql` — row-level security for leaderboard reads
- `migration-enforce-bans.sql` — enforces account bans at the database layer
- `migration-security-hardening.sql` — tightens grants and policies
- `migration-site-stats.sql` — aggregate site statistics
- `migration-movie-dedup.sql` — removes duplicate movie entries
- `migration-movie-renumber.sql` — renumbers the movie entries after dedup
- `migration-chat-realtime.sql` — adds `chat_messages` to the realtime publication
- `migration-chat-purge-12h.sql` — pg_cron job deleting chat messages older than 12 hours, hourly
- `migration-fix-runtime-minutes.sql` — repairs `runtime_minutes` (NULL episodes and imported source IDs)
- `migration-magic-kaito-1412.sql` — restructures Magic Kaito 1412 into 24 individual episodes with wiki lookup keys

## Content Sync

`/api/sync` pulls from Jikan (episodes), Kitsu (franchise entries) and AniList (airing schedule). Nothing is written to `content_entries` directly — new entries are staged for review and published from the admin sync page.

## Development

```bash
npm run lint
npm run test
npm run build
```

## Deployment

Hosted on Vercel. Only `main` auto-deploys; production deployments from other branches are disabled in `vercel.json`, and the `production` branch is a mirror. Vercel's Production Branch must stay set to `main` or the cron jobs stop running.

Scheduled jobs, both authenticated with `CRON_SECRET`:

- `/api/sync?mode=airing` — daily
- `/api/sync?mode=seed` — weekly

## License

Not affiliated with Gosho Aoyama.
