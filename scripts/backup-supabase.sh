#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DCPH-Tracker — Supabase backup (run nightly; see .github/workflows).
#
# Produces a dated folder under $BACKUP_ROOT (default ~/backups/dcph/supabase):
#   dcph-public.dump          pg_dump custom archive of the `public` schema
#   dcph-public.sql.gz        the same dump as plain SQL (readable, greppable)
#   auth-users.json           every auth user via the admin API  (contains PII)
#   storage/…                 a mirror of every storage object   (avatars, …)
#   storage-manifest.json     object list with sizes
#   MANIFEST.txt              what was captured, sizes, sha256
#
# Requires: pg_dump (postgresql client) + node >= 20.
#   Alpine:  sudo apk add postgresql17-client   (any version >= server works)
#   Ubuntu:  sudo apt-get install postgresql-client
#
# Connection string — use the SESSION POOLER (IPv4, port 5432):
#   Supabase dashboard → Connect → Session pooler → copy the URI.
#   NOT db.<ref>.supabase.co (IPv6-only on the free plan — unreachable from
#   most home networks / CI runners) and NOT the transaction pooler on 6543
#   (pg_dump needs session semantics).
# Put it in .env.local (gitignored) as:
#   SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
#
# Usage:    ./scripts/backup-supabase.sh
# Rotation: keeps the newest $BACKUP_KEEP runs (default 14).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."
ROOT="${BACKUP_ROOT:-$HOME/backups/dcph/supabase}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$ROOT/$STAMP"

# Read one key from .env.local without exporting the whole file (and strip the
# CRLF that a Windows editor may have left on the line).
envval() {
  [ -f .env.local ] || return 0
  # `|| true` keeps `set -e` from aborting when the key is absent.
  grep -E "^$1=" .env.local 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' || true
}

DB_URL="${SUPABASE_DB_URL:-$(envval SUPABASE_DB_URL)}"
SB_URL="${NEXT_PUBLIC_SUPABASE_URL:-$(envval NEXT_PUBLIC_SUPABASE_URL)}"
SB_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$(envval SUPABASE_SERVICE_ROLE_KEY)}"

if [ -z "$DB_URL" ]; then
  echo "✗ SUPABASE_DB_URL is not set (env var or .env.local) — see the header of this script." >&2
  exit 2
fi
command -v pg_dump >/dev/null || { echo "✗ pg_dump not found — install a postgresql client package." >&2; exit 2; }

mkdir -p "$OUT"

echo "→ pg_dump (custom format) …"
pg_dump "$DB_URL" --no-owner --no-privileges --schema=public -Fc -f "$OUT/dcph-public.dump"

echo "→ pg_dump (plain SQL, gzipped) …"
pg_dump "$DB_URL" --no-owner --no-privileges --schema=public | gzip -9 > "$OUT/dcph-public.sql.gz"

if [ -n "$SB_URL" ] && [ -n "$SB_KEY" ]; then
  echo "→ auth users + storage objects …"
  NEXT_PUBLIC_SUPABASE_URL="$SB_URL" SUPABASE_SERVICE_ROLE_KEY="$SB_KEY" \
    node scripts/backup-supabase-extras.mjs "$OUT"
else
  echo "! NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipped auth + storage capture." >&2
fi

{
  echo "DCPH-Tracker Supabase backup"
  echo "when:  $(date -u +%FT%TZ)"
  echo "host:  $(printf '%s' "$DB_URL" | sed -E 's#//[^@]*@#//***@#')"
  echo
  echo "files:"
  (cd "$OUT" && find . -type f | sort | while read -r f; do printf '  %-64s %10s bytes\n' "$f" "$(wc -c < "$f")"; done)
  echo
  echo "sha256 (dumps):"
  (cd "$OUT" && { sha256sum dcph-public.dump dcph-public.sql.gz 2>/dev/null || shasum -a 256 dcph-public.dump dcph-public.sql.gz; })
} > "$OUT/MANIFEST.txt"

# Rotate: keep the newest $KEEP runs. Stamp names sort lexicographically.
if [ -d "$ROOT" ]; then
  ls -1d "$ROOT"/*/ 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -rf -- "$old"
  done
fi

echo "✓ backup complete → $OUT"
du -sh "$OUT"
