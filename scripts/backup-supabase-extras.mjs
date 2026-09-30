#!/usr/bin/env node
/**
 * DCPH-Tracker — Supabase "extras" backup: auth users + storage objects.
 *
 *   node scripts/backup-supabase-extras.mjs <outDir>
 *
 * Env (from .env.local via `node --env-file=.env.local`, or the environment):
 *   NEXT_PUBLIC_SUPABASE_URL      project URL
 *   SUPABASE_SERVICE_ROLE_KEY     service-role key (bypasses RLS)
 *
 * Produces:
 *   <outDir>/auth-users.json         every user via the GoTrue admin API (PII!)
 *   <outDir>/storage/<bucket>/…      a mirror of every storage object
 *   <outDir>/storage-manifest.json   object list + sizes (with a `failures` list)
 *
 * No npm dependencies — plain fetch, so it also runs in GitHub Actions
 * without an install step. Read-only against Supabase.
 *
 * Exit code: 0 = everything captured; 1 = finished with per-object failures
 * (listed in the manifest); 2 = configuration problem.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const outDir = process.argv[2];

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
if (!outDir) {
  console.error("Usage: node scripts/backup-supabase-extras.mjs <outDir>");
  process.exit(2);
}

const MAX_STORAGE_BYTES = Number(process.env.BACKUP_MAX_STORAGE_BYTES ?? 2 * 1024 * 1024 * 1024); // 2 GiB guard
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const failures = [];

// ── auth users ────────────────────────────────────────────────────────────────
async function backupAuthUsers() {
  const all = [];
  let total = null;
  for (let page = 1; page <= 100; page++) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) throw new Error(`auth list failed: HTTP ${res.status}`);
    if (total === null) {
      const t = res.headers.get("x-total-count");
      total = t ? Number(t) : null;
    }
    const json = await res.json();
    const users = Array.isArray(json) ? json : json.users ?? [];
    all.push(...users);
    if (users.length < 200 || (total !== null && all.length >= total)) break;
  }
  await writeFile(join(outDir, "auth-users.json"), JSON.stringify(all, null, 2));
  console.log(`  auth users: ${all.length}${total !== null ? ` / ${total}` : ""}`);
  return all.length;
}

// ── storage ──────────────────────────────────────────────────────────────────
/**
 * Full object path. The list API returns names RELATIVE to the prefix, but a
 * name can legitimately begin with the same characters as its folder (folder
 * "test" holding "test-123.jpg" is returned as "test-123.jpg"), so compare on
 * the path-segment boundary rather than a bare string prefix — otherwise the
 * folder segment is silently dropped and the object 404s.
 */
function joinPath(prefix, name) {
  if (!prefix) return name;
  return name.startsWith(`${prefix}/`) || name === prefix ? name : `${prefix}/${name}`;
}

async function walkBucket(bucket, prefix, acc, depth = 0) {
  if (depth > 12) {
    failures.push({ bucket, path: prefix, error: "max folder depth exceeded" });
    return;
  }
  let offset = 0;
  for (;;) {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) {
      failures.push({ bucket, path: prefix, error: `list failed: HTTP ${res.status}` });
      return;
    }
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      const path = joinPath(prefix, item.name);
      try {
        if (!item.id || !item.metadata) {
          // Folder placeholder — recurse.
          await walkBucket(bucket, path, acc, depth + 1);
          continue;
        }
        await downloadObject(bucket, path, Number(item.metadata?.size ?? 0), acc);
      } catch (err) {
        const msg = String(err?.message ?? err);
        if (msg.includes("BACKUP_MAX_STORAGE_BYTES")) throw err; // honour the hard cap
        failures.push({ bucket, path, error: msg });
      }
    }
    offset += items.length;
    if (items.length < 100) break;
  }
}

async function downloadObject(bucket, path, size, acc) {
  acc.bytes += size;
  if (acc.bytes > MAX_STORAGE_BYTES) {
    throw new Error(`storage exceeds BACKUP_MAX_STORAGE_BYTES (${MAX_STORAGE_BYTES}); raise it deliberately if intended`);
  }
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  let res = await fetch(`${url}/storage/v1/object/public/${bucket}/${encoded}`, { headers });
  if (!res.ok) {
    // Private bucket: ask for a short-lived signed URL instead.
    const sign = await fetch(`${url}/storage/v1/object/sign/${bucket}/${encoded}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!sign.ok) throw new Error(`sign ${bucket}/${path} failed: HTTP ${sign.status}`);
    const { signedURL } = await sign.json();
    res = await fetch(`${url}/storage/v1${signedURL}`, { headers });
    if (!res.ok) throw new Error(`download ${bucket}/${path} failed: HTTP ${res.status}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const dest = join(outDir, "storage", bucket, ...path.split("/"));
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  acc.files.push({ path, size: bytes.length });
  if (acc.files.length % 25 === 0) console.log(`  … ${acc.files.length} objects`);
}

async function backupStorage() {
  const res = await fetch(`${url}/storage/v1/bucket`, { headers });
  if (!res.ok) throw new Error(`bucket list failed: HTTP ${res.status}`);
  const buckets = await res.json();
  const manifest = { capturedAt: new Date().toISOString(), buckets: [], failures: [] };
  let totalFiles = 0;
  let totalBytes = 0;
  for (const bucket of buckets) {
    const acc = { files: [], bytes: 0 };
    await walkBucket(bucket.name, "", acc);
    manifest.buckets.push({ name: bucket.name, public: bucket.public, objects: acc.files, bytes: acc.bytes });
    totalFiles += acc.files.length;
    totalBytes += acc.bytes;
    console.log(`  bucket ${bucket.name}: ${acc.files.length} objects, ${(acc.bytes / 1048576).toFixed(1)} MB`);
  }
  manifest.totalObjects = totalFiles;
  manifest.totalBytes = totalBytes;
  manifest.failures = failures;
  await writeFile(join(outDir, "storage-manifest.json"), JSON.stringify(manifest, null, 2));
  return { totalFiles, totalBytes };
}

// ── main ─────────────────────────────────────────────────────────────────────
await mkdir(outDir, { recursive: true });
console.log("backing up auth users …");
await backupAuthUsers();
console.log("backing up storage …");
const storage = await backupStorage();
const size = `${(storage.totalBytes / 1048576).toFixed(1)} MB`;
if (failures.length > 0) {
  console.error(`⚠ extras finished with ${failures.length} failure(s) — ${storage.totalFiles} objects captured, ${size}:`);
  for (const f of failures.slice(0, 20)) console.error(`   ✗ ${f.bucket}/${f.path ?? ""} — ${f.error}`);
  if (failures.length > 20) console.error(`   … ${failures.length - 20} more (see storage-manifest.json)`);
  process.exitCode = 1;
} else {
  console.log(`✓ extras complete: ${storage.totalFiles} objects, ${size}`);
}
