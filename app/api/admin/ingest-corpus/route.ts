// app/api/admin/ingest-corpus/route.ts
//
// The cron/manual entry point for the retrieval corpus: read the tracker
// tables, build the documents, and diff-write them into ai_documents.
//
// Two doors, one job. POST is the manual/admin path and keeps the
// `x-admin-secret` header it has always used. GET exists because a Vercel cron
// issues GET and sends `Authorization: Bearer $CRON_SECRET`, not that header --
// without it the corpus-refresh cron entry could never run. Both authenticate
// before the shared `runIngest` touches the database.
//
//   curl -X POST "$BASE/api/admin/ingest-corpus" -H "x-admin-secret: $SECRET"
//   curl -X POST "$BASE/api/admin/ingest-corpus?dryRun=1" -H "x-admin-secret: $SECRET"
//   curl "$BASE/api/admin/ingest-corpus" -H "Authorization: Bearer $CRON_SECRET"
import { NextResponse } from "next/server"

import { collectCorpus, type CollectClient } from "@/lib/ai/corpus/collect"
import { ingestCorpus, type IngestClient } from "@/lib/ai/corpus/ingest"
import { cronSecret, headerMatchesSecret } from "@/lib/cron-auth"
import { createAdminClient } from "@/utils/supabase/admin"

/** The collection walk pages both tracker tables, so it gets the full window. */
export const maxDuration = 300

/**
 * The work both handlers share, reached only after each has authenticated in
 * its own way. It reads `?dryRun=1` and never the secret, so the two doors
 * cannot disagree about what the job does.
 */
async function runIngest(request: Request) {
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1"
  const startedAt = Date.now()

  try {
    const client = createAdminClient()

    // `null` means the service-role env is missing. The collaborators are
    // structurally typed, so passing null would throw somewhere inside a query
    // chain; fail here with the message sync-crimes already uses.
    if (!client) {
      return NextResponse.json(
        { ok: false, error: "Missing Supabase service role env vars" },
        { status: 500 }
      )
    }

    const documents = await collectCorpus(client as unknown as CollectClient)
    const report = await ingestCorpus({
      client: client as unknown as IngestClient,
      documents,
      dryRun,
    })

    return NextResponse.json({
      ok: true,
      docs: documents.length,
      dryRun,
      report,
      ms: Date.now() - startedAt,
    })
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  // Guard first: an unauthenticated call must not reach the database at all.
  const secret = process.env.ADMIN_TASK_SECRET || process.env.CRON_SECRET
  if (!secret || request.headers.get("x-admin-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  return runIngest(request)
}

export async function GET(request: Request) {
  // A Vercel cron's only credential is `Authorization: Bearer $CRON_SECRET`.
  // Same guard-first rule as POST: no database work before the secret matches.
  if (!headerMatchesSecret(request.headers.get("authorization"), cronSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  return runIngest(request)
}
