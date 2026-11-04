# Agent rules for this repository

Read this before touching git. Carlo is the only one who commits and pushes here.

## Never do these without being asked in that message

**Do not run `git commit`.** Leave finished work in the working tree and report
what changed. Carlo reviews the diff and commits himself. "Fix this", "make it
work", "ship it in the branch" are requests to change code, not permission to
commit.

**Do not run `git push` to `staging` or `main`.** Ever, under any phrasing. Those
branches are release controls, not scratch space. A push to either is treated as
a deployment decision that only Carlo makes.

**Do not run `git checkout`/`switch` away from the branch you were given.** Stay
on it. If the work genuinely needs a new branch, say so and wait.

**Do not run `git reset --hard`, `git clean -fd`, `git push --force`, or any
history rewrite.** They destroy uncommitted work that was never committed
*because* commits are his.

## What to do instead

Make the edits, run the checks, then report:

- which files changed and what each change does
- verification actually run (typecheck, lint, tests, build) and its real output
- what is left, including anything blocked

Then stop. Carlo commits.

If a commit is explicitly requested in the current message, commit to the branch
you are on. If a push is explicitly requested, push only that branch unless the
message names another.

## Branch layout

| Branch | Role |
| --- | --- |
| `main` | Release line. Default branch. Protected by a ruleset: pull requests required, no force-push, no deletion. |
| `staging` | Pre-release line. Same commit as `main` unless a staging build is in flight. |
| `production` | Deploy mirror. Not the same as `main` — it runs ahead or behind depending on release timing. |
| `feat/*` | Work branches. Every change starts here. |

`production` is **not** a live pointer to what is deployed — Vercel's Production
Branch is `main`. Treat branch position and deploy state as separate facts and
check both before claiming something is live.

## Deployment facts that trip people up

`vercel.json` disables automatic deployments from **both** `main` and
`production`:

```json
{ "git": { "deploymentEnabled": { "production": false, "main": false } } }
```

So a successful push proves nothing about the live site. Production ships by
promoting a preview or running `vercel --prod`. After any push, verify the live
URL before saying it shipped — for this repo that means fetching the real route
and looking for a string only the new build would have.

The README's Deployment section is out of date on this point. Trust `vercel.json`.

## Repository conventions

- Next.js App Router, TypeScript strict, Tailwind. Server components by default;
  `"use client"` only where interactivity demands it.
- Supabase for data. Table is `content_entries`, not `content`.
- No secrets in code or commits. `.env.local` holds the real values and is never
  printed, copied, or committed. Refer to variables by name only.
- Git on `/mnt/c` reports whole files as modified when only line endings changed.
  Before committing anything, run `git diff --ignore-cr-at-eol` — if it is empty,
  the file has no real change and must not be committed.
- Extract logic that deserves tests into `lib/` so it can be tested without React
  or Supabase. Components render; `lib` decides.

## Before reporting work as done

Run and report the real output of:

```bash
npx tsc --noEmit
npm run lint
npm run test
```

A claim that something works without that output is not a finished task. If a
check could not be run, say so and say why — never fill the gap with a plausible
result.
