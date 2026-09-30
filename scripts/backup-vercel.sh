#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DCPH-Tracker — Vercel-side backup: everything that is NOT already in git.
#
# Grabs:
#   dcph-repo.bundle          a full git bundle (all branches + tags)
#   git-info.txt              remotes / branches / last commits
#   vercel-env-production.txt production env vars (SECRETS — keep private!)
#
# Needs the Vercel CLI, either:
#   * export VERCEL_TOKEN=… (Vercel dashboard → Account Settings → Tokens), or
#   * run `npx vercel login` once interactively.
# The project must be linked for `vercel env pull` — if it is not, run:
#   npx vercel link          (choose the DCPH-Tracker project)
#
# Usage:  VERCEL_TOKEN=… ./scripts/backup-vercel.sh
# Output: ~/backups/dcph/vercel/<stamp>/
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."
ROOT="${BACKUP_ROOT:-$HOME/backups/dcph/vercel}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$ROOT/$STAMP"
mkdir -p "$OUT"

echo "→ git bundle (all branches) …"
git bundle create "$OUT/dcph-repo.bundle" --all

echo "→ git metadata …"
{
  echo "# remotes"; git remote -v
  echo; echo "# branches"; git branch -a
  echo; echo "# last commits"; git --no-pager log -5 --pretty=fuller
} > "$OUT/git-info.txt" 2>&1 || true

echo "→ vercel env pull (production) …"
if command -v npx >/dev/null 2>&1; then
  if npx --yes vercel env pull "$OUT/vercel-env-production.txt" --environment=production --yes; then
    echo "  ✓ env vars pulled — this file contains SECRETS, treat it like .env.local."
  else
    echo "  ! vercel env pull failed — is the project linked? Run: npx vercel link" >&2
  fi
fi

echo "✓ → $OUT"
ls -la "$OUT"
