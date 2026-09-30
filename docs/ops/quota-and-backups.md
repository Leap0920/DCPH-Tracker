# Quota & backups runbook — DCPH-Tracker

Written 2026-09-30 after both free plans showed exceeded usage:
`Fast Data Transfer 110/100 GB` and `Image Transformations 5.3K/5K` on
Vercel (Hobby), `Log Ingestion 1.374/1 GB (137%)` on Supabase (Free).

This file explains what was changed, what you still need to do in each
dashboard, how to back the project up, and what to do if a quota runs out
while the site is live.

---

## 1. What caused it

**Vercel — Fast Data Transfer (110 GB).** The homepage carousel
(`components/ui/elegant-carousel.tsx`, used by `FiveYearsSection`) rendered
four ~40 MB block-screening videos with `autoPlay` + `preload="auto"`, plus a
6.6 MB 4K60 `Banner.mp4` in the hero. Every visit streamed tens of MB
whether or not the visitor ever watched. Every byte served from Vercel —
cached or not — counts as Fast Data Transfer.

**Vercel — Image Transformations (5.3K).** `next.config.ts` had
`formats: ["image/avif", "image/webp"]` (every variant transformed twice),
the default 60-second cache TTL (re-transformed on every sweep), the full
16-combination size spread, and `remotePatterns: "**"` (any URL on the
internet could be optimized through this deployment).

**Supabase — Log Ingestion (137%).** The homepage hero stats were the chatty
part: `record_visit()` + `get_site_stats()` on every pageview, then
`heartbeat()` + `get_site_stats()` **every 60 seconds per open tab**, plus an
`auth.getUser()` network call each minute. Each request is a logged PostgREST
/ Auth call. Note the dashboard badge says **UPCOMING** — Supabase is not yet
enforcing this quota, and the banner says the plan quota is not exceeded in
this cycle; treat it as a warning to get under the line before it is enforced.

## 2. Changes applied in this repo (deploy to take effect)

| File | Change |
| --- | --- |
| `next.config.ts` | Image guardrails: webp only, `minimumCacheTTL` 31 days, 4 device sizes + 4 image sizes, `remotePatterns` limited to the hosts the DB actually uses (DCW, Kitsu, Amazon, TMDB, Wikimedia, Supabase, OAuth avatars). Emergency switch: `IMAGE_OPTIMIZATION_DISABLED=true` env bypasses the optimizer entirely. |
| `components/ui/elegant-carousel.tsx` | `AUTOPLAY_MUTED = false` — slides show a poster (`imageUrl`) and pull **no video bytes** until tapped; `preload="metadata"`; videos start one-tap. Flip to `true` to restore autoplay only if the media gets much smaller or moves off Vercel. |
| `public/videos/*.mp4`, `public/img/Banner.mp4` | Re-encoded: 720p-max H.264, 2-pass ~750k ABR, faststart. Originals kept in git history and in `~/backups/dcph/videos-master/`. |
| `middleware.ts` | Media extensions (`mp4/webm/mp3/…`) skip the edge middleware — `/videos` range requests no longer route through session/CSP work. |
| `lib/queries/client/stats.ts` | Prefers the new single-request RPCs (`heartbeat_and_get_stats`, `record_visit_and_get_stats`), falls back to the old pairs when the migration isn't applied. |
| `components/marketing/LiveStats.tsx` | Heartbeat only while the tab is visible; `getSession()` (local) instead of `getUser()` (network, once/minute/tab). |
| `supabase/migration-site-stats-single-call.sql` | **Apply in the SQL editor** — halves the hero's PostgREST requests. Optional for correctness; the client falls back either way. |
| `scripts/backup-supabase.sh` + `scripts/backup-supabase-extras.mjs` | Full Supabase backup (pg_dump + auth users + storage mirror). |
| `scripts/backup-vercel.sh` | Vercel-side backup: git bundle + `vercel env pull`. |
| `scripts/optimize-videos.sh` | Re-encode a video at any target bitrate (the quality knob). |
| `.github/workflows/supabase-backup.yml` | Nightly cloud backup → GitHub artifact (90 days). |
| `components/ui/__tests__/elegant-carousel.dom.test.tsx` | Updated for the no-autoplay start (tap-then-`play` event). |

Re-encode results (old → new): BS2023 38.8→24.9 MB, BS2024 47.8→28.7 MB,
BS2025 42.6→32.3 MB, BS2026 44.0→33.3 MB, Banner 6.6→0.7 MB — **180 MB → 120 MB**.

## 3. One-time setup checklist

1. **Deploy** (production deploys are disabled for git pushes in
   `vercel.json`, so a manual production deploy is required):
   `npx vercel --prod` (or your usual flow).
2. **Apply the migration**: Supabase Dashboard → SQL Editor → paste
   `supabase/migration-site-stats-single-call.sql` → Run.
3. **Add the database connection string** to `.env.local` (for local
   backups) — Dashboard → Connect → **Session pooler** (IPv4, port 5432):
   `SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   Do **not** use `db.<ref>.supabase.co` (IPv6-only on free) or the 5432/6543
   transaction pooler for pg_dump.
4. **Add GitHub secrets** (repo → Settings → Secrets and variables →
   Actions): `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY`, so the
   nightly workflow runs.
5. **Run a first backup**: `./scripts/backup-supabase.sh`
   (needs a postgres client; `sudo apk add postgresql15-client` — if
   pg_dump complains the server is newer, the GitHub Action uses pgdg 17,
   or install a matching client).
6. **Turn on usage alerts**: Vercel → team Settings → Billing/Notifications
   (usage alert emails); keep an eye on Supabase → Project → Usage.
7. Optional: `./scripts/backup-vercel.sh` (needs `VERCEL_TOKEN`) to capture
   production env vars + a full git bundle.

## 4. What still costs transfer, and the next lever

Even after this change, a tapped video streams ~25-33 MB from Vercel, and
images/HTML keep flowing. If usage creeps toward 100 GB again, in order of
impact:

1. **Move the videos off Vercel** (biggest lever):
   - **YouTube (unlisted)** — free, zero transfer, ads-free embeds; swap the
     `<video>` for an iframe behind the poster.
   - **Cloudflare R2** — 10 GB storage free, **zero egress fees**; create a
     bucket (e.g. `dcph-media`), upload `videos/*.mp4`, add a custom domain
     or use the `r2.dev` URL, then point the carousel/hero at those URLs.
     (The `CLOUDFLARE_API_TOKEN` in `.env.local` is active but cannot list
     accounts/zones, so bucket setup must be done in the Cloudflare
     dashboard or with a freshly scoped token.)
2. **Compress further** — `./scripts/optimize-videos.sh in.mp4 out.mp4 600k`.
3. **Cloudflare in front of Vercel** (free plan, unlimited bandwidth):
   move DNS to Cloudflare and enable caching for static assets — cheap
   static bytes stop counting against Vercel at all.
4. Consider Vercel Pro if the site is growing past hobby limits — it lifts
   pause risk and adds on-demand overage instead of a 30-day freeze.

## 5. Emergency playbook (if a quota runs out while live)

- **Image transformations paused** (images break): set
  `IMAGE_OPTIMIZATION_DISABLED=true` in Vercel → Settings → Environment
  Variables, then redeploy. Images render straight from source.
- **Fast Data Transfer exhausted** (account/features pause until the metric
  ages out — up to 30 days on Hobby): the site may be paused; fastest
  mitigation is deploying the same repo to a fallback host — Netlify free
  (100 GB/mo) or Cloudflare Pages — with the same env vars; keep it as a
  warm standby and switch DNS (or hand out the URL).
- **Supabase**: data is not at risk from log ingestion; if the project ever
  gets too chatty, lengthen client intervals first (`LiveStats` 60s,
  `NotificationBell` 45s, `ChatWindow` fallback 6s — all in the repo), then
  review Realtime and Log Drains (Dashboard → Project Settings → Log Drains;
  there should be none on free).

## 6. Backups — what runs where

| What | Where | When |
| --- | --- | --- |
| public schema dump (custom + SQL) | `~/backups/dcph/supabase/<stamp>/` (keeps 14) | manual: `./scripts/backup-supabase.sh` |
| auth users JSON + storage mirror (avatars, content-images) | same folder | with the script above |
| The same, in the cloud | GitHub Action artifact (90 days) | nightly 02:23 UTC |
| Repo bundle + Vercel env vars | `~/backups/dcph/vercel/<stamp>/` | manual: `./scripts/backup-vercel.sh` |
| Originals of the videos | `~/backups/dcph/videos-master/` + git history | once (2026-09-30) |

Artifacts/dumps contain **user PII** (emails, avatars, auth records) — keep
the repo private and the backup folder mode 700.

### Restore — Supabase (to a fresh project)

1. Create a new Supabase project; run `supabase/schema.sql` then the
   `supabase/migration-*.sql` files in order (schema is source-controlled).
2. Restore data: `pg_restore --no-owner --no-privileges --clean --if-exists \
   -d "$NEW_SESSION_POOLER_URL" dcph-public.dump` (or `psql < dcph-public.sql.gz`).
3. Auth users: `auth-users.json` is the recovery source — re-invite users or
   re-create via the admin API; auth passwords cannot be unpacked from a dump
   into a new project. The storage mirror restores via Dashboard upload or
   `supabase storage cp`.
4. Update `NEXT_PUBLIC_SUPABASE_URL` / keys in Vercel env, redeploy, rotate
   the service-role key.

### Restore — Vercel (to Netlify / Cloudflare / new Vercel project)

1. Push/clone the repo (the bundle has every branch).
2. New host → import repo → set env vars from `vercel-env-production.txt`
   (or Vercel → Settings → Environment Variables).
3. Build command `npm run build`; the site needs Node 20+.

## 7. Notes / gotchas

- This working tree has ~300 CRLF-noise modifications (no `.gitattributes`);
  use `git diff --ignore-cr-at-eol` to see real changes.
- When replacing a video file, keep the same filename or update
  `elegant-carousel.tsx` / `HeroSection.tsx`; deploy again (edge caches by
  ETag, stale copies age out quickly).
- Re-encode settings live in `scripts/optimize-videos.sh` — the bitrate is
  the only knob you should need.
- `vercel.json` has `"deploymentEnabled": { "production": false }` — git
  pushes won't deploy production; this is intentional, don't be surprised.
