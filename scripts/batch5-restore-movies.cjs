const fs = require("fs");
const path = require("path");

// Read service key from .env.local
const envPath = path.join(process.cwd(), ".env.local");
const envRaw = fs.readFileSync(envPath, "utf8");
const keyMatch = envRaw.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
const SERVICE_KEY = keyMatch ? keyMatch[1].trim() : null;
if (!SERVICE_KEY) { console.error("NO_SERVICE_KEY"); process.exit(1); }

const SUPABASE_URL = "https://hgwtlbbbkxppbasbhvlo.supabase.co";
const BACKUP_PATH = path.join(process.cwd(), "scripts", ".sisyphus", "evidence", "batch4-movies-backup.json");
const SLUGS_TO_RESTORE = ["mov-19", "mov-22", "mov-37", "mov-41"];

const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, "utf8"));
const rows = Array.isArray(backup) ? backup : backup.rows;
const toRestore = rows.filter((r) => SLUGS_TO_RESTORE.includes(r.slug));
console.log("TO_RESTORE:", toRestore.length);
if (toRestore.length !== 4) { console.error("EXPECTED 4 ROWS, GOT " + toRestore.length); process.exit(1); }

// Check which slugs already exist (idempotent re-run safety)
async function existingSlugs() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/content_entries?select=slug&slug=in.(${SLUGS_TO_RESTORE.join(",")})`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const data = await res.json();
  return new Set((data || []).map((r) => r.slug));
}

(async () => {
  const existing = await existingSlugs();
  let inserted = 0, skipped = 0;
  for (const row of toRestore) {
    if (existing.has(row.slug)) { console.log(`SKIP existing: ${row.slug}`); skipped++; continue; }
    const payload = {
      slug: row.slug,
      title: row.title,
      type: row.type,
      episode_number: row.episode_number ?? null,
      movie_number: row.movie_number ?? null,
      air_date: row.air_date,
      canon_order: row.canon_order ?? null,
      release_order: row.release_order ?? null,
      arc_id: row.arc_id ?? null,
      synopsis: row.synopsis ?? null,
      image_url: row.image_url ?? null,
      runtime_minutes: row.runtime_minutes ?? null,
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/content_entries`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(payload),
    });
    console.log(`INSERT ${row.slug}: ${res.status}`);
    if (res.ok) inserted++; else { console.error(await res.text()); }
  }
  console.log(`DONE inserted=${inserted} skipped=${skipped}`);
})();
