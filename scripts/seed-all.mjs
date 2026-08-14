import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const srvKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !srvKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, srvKey);

async function parseAndSeed() {
  console.log('Reading seed-content.sql...');
  const contentSql = fs.readFileSync('supabase/seed-content.sql', 'utf8');
  const lines = contentSql.split('\n');

  const rows = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("('")) continue;

    const cleaned = trimmed.replace(/^(\(|values\s*\(|\,\s*\()/i, '').replace(/(\);?|\),?)$/, '');

    const parts = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      if (char === "'" && (i === 0 || cleaned[i - 1] !== '\\')) {
        inQuote = !inQuote;
      } else if (char === ',' && !inQuote) {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    if (cur.trim()) parts.push(cur.trim());

    if (parts.length >= 7) {
      const cleanVal = (val) => {
        if (!val || val === 'NULL' || val === 'null') return null;
        if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1).replace(/''/g, "'");
        const num = Number(val);
        return Number.isFinite(num) ? num : val;
      };

      const slug = cleanVal(parts[0]);
      const title = cleanVal(parts[1]);
      const type = cleanVal(parts[2]);

      if (slug && title && type) {
        rows.push({
          slug,
          title,
          type,
          episode_number: cleanVal(parts[3]),
          movie_number: cleanVal(parts[4]),
          air_date: cleanVal(parts[5]),
          canon_order: cleanVal(parts[6]) ?? 0,
          release_order: parts.length > 7 ? cleanVal(parts[7]) : null,
          synopsis: parts.length > 9 ? cleanVal(parts[9]) : null,
          image_url: parts.length > 10 ? cleanVal(parts[10]) : null,
          runtime_minutes: parts.length > 11 ? cleanVal(parts[11]) : null,
        });
      }
    }
  }

  console.log(`Parsed ${rows.length} content entries from seed-content.sql.`);
  
  if (rows.length > 0) {
    const BATCH_SIZE = 100;
    let inserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from('content_entries').upsert(batch, { onConflict: 'slug' });
      if (error) {
        console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${error.message}`);
      } else {
        inserted += batch.length;
      }
    }

    console.log(`Successfully upserted ${inserted} / ${rows.length} content entries into Supabase!`);
  }
}

parseAndSeed().catch((err) => {
  console.error('Fatal error during seed:', err);
  process.exit(1);
});
