#!/usr/bin/env bash
#
# Review and apply a single migration SQL file to the linked Supabase project.
#
# Usage:
#   ./scripts/apply-migration.sh supabase/migrations/20260821120000_add_feature.sql
#   ./scripts/apply-migration.sh --all          # push every pending migration
#   ./scripts/apply-migration.sh --dry-run <f>  # print only, never execute
#
# Requires either:
#   - psql + $SUPABASE_DB_URL  (applies exactly the reviewed file), or
#   - supabase CLI, linked     (--all only; pushes all pending migrations)
#
set -Eeuo pipefail

RED=$'\033[31m'; YEL=$'\033[33m'; GRN=$'\033[32m'; DIM=$'\033[2m'; RST=$'\033[0m'

die() { printf '%s%s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }
info() { printf '%s%s%s\n' "$DIM" "$*" "$RST"; }

DRY_RUN=0
MODE="file"
FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --all)     MODE="all"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    -*)        die "Unknown flag: $1" ;;
    *)         FILE="$1"; shift ;;
  esac
done

confirm() {
  local prompt="$1" reply=""
  if [ ! -t 0 ]; then
    die "Refusing to run non-interactively. Re-run from a terminal."
  fi
  printf '%s%s%s ' "$YEL" "$prompt" "$RST"
  read -r reply || reply=""
  case "$reply" in
    y|Y|yes|YES) return 0 ;;
    *) info "Aborted."; exit 0 ;;
  esac
}

if [ "$MODE" = "all" ]; then
  command -v supabase >/dev/null 2>&1 \
    || die "supabase CLI not found. Install it, or apply a single file instead."

  echo "Pending migrations:"
  supabase migration list || true
  echo ""
  echo "${YEL}This pushes ALL pending migrations to the LINKED REMOTE project.${RST}"
  [ "$DRY_RUN" -eq 1 ] && { info "[dry-run] would run: supabase db push"; exit 0; }
  confirm "Continue? (y/N)"
  supabase db push
  printf '%sDone.%s\n' "$GRN" "$RST"
  exit 0
fi

[ -n "$FILE" ] || die "Usage: $0 <migration-file.sql> | --all"
[ -f "$FILE" ] || die "File not found: $FILE"

echo "${DIM}=== $FILE ===${RST}"
cat "$FILE"
echo "${DIM}=== end ($(wc -l < "$FILE" | tr -d ' ') lines) ===${RST}"
echo ""

# Loud warning for statements that can destroy data.
if grep -Eiq '\b(drop\s+(table|schema|column|database)|truncate|delete\s+from)\b' "$FILE"; then
  printf '%s!! This migration contains DESTRUCTIVE statements (DROP/TRUNCATE/DELETE).%s\n' "$RED" "$RST"
  printf '%s!! Take a backup before continuing.%s\n\n' "$RED" "$RST"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  info "[dry-run] nothing executed."
  exit 0
fi

if [ -n "${SUPABASE_DB_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  host="$(printf '%s' "$SUPABASE_DB_URL" | sed -E 's|.*@([^/:]+).*|\1|')"
  echo "Target: ${host}"
  confirm "Apply this migration via psql? (y/N)"
  # Single transaction: the whole file rolls back on any error.
  psql "$SUPABASE_DB_URL" \
    --single-transaction \
    --set ON_ERROR_STOP=on \
    --file "$FILE"
  printf '%sApplied: %s%s\n' "$GRN" "$FILE" "$RST"
  exit 0
fi

cat <<EOF

${YEL}No automated path available.${RST}
  - Set SUPABASE_DB_URL and install psql to apply this exact file, or
  - install the supabase CLI and use: $0 --all, or
  - paste the SQL above into the Supabase Dashboard SQL Editor.

EOF
exit 1
