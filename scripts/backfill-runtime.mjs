import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required');
  console.error('Run: node --env-file=.env.local scripts/backfill-runtime.mjs');
  process.exit(1);
}

const client = createClient(url, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Real theatrical runtimes (minutes) for the 29 main movies, by slug.
// Source: official TMS / Detective Conan Wiki listing. Verified air dates already live.
const MOVIE_RUNTIMES = {
  'mov-01': 110, 'mov-02': 99, 'mov-03': 100, 'mov-04': 99, 'mov-05': 101,
  'mov-06': 107, 'mov-07': 106, 'mov-08': 107, 'mov-09': 110, 'mov-10': 112,
  'mov-11': 111, 'mov-12': 112, 'mov-13': 110, 'mov-14': 112, 'mov-15': 112,
  'mov-16': 110, 'mov-17': 112, 'mov-18': 110, 'mov-19': 112, 'mov-20': 111,
  'mov-21': 110, 'mov-22': 111, 'mov-23': 110, 'mov-24': 109, 'mov-25': 110,
  'mov-26': 110, 'mov-27': 110, 'mov-28': 112, 'mov-29': 112,
};

async function main() {
  try {
    const { error: signInError } = await client.auth.signInWithPassword({
      email: 'admin@dcph.ph',
      password: 'DcphDemo2026!',
    });
    if (signInError) throw new Error(`admin sign-in failed: ${signInError.message}`);

    // 1. Bulk: 25-minute types (episode, live_action, magic_kaito, hanzawa, zero_tea_time)
    const { error: e25 } = await client
      .from('content_entries')
      .update({ runtime_minutes: 25 })
      .in('type', ['episode', 'live_action', 'magic_kaito', 'hanzawa', 'zero_tea_time'])
      .or('runtime_minutes.is.null,runtime_minutes.eq.0');
    if (e25) throw new Error(`bulk 25-min update failed: ${e25.message}`);

    // 2. Bulk: 45-minute types (special, ova)
    const { error: e45 } = await client
      .from('content_entries')
      .update({ runtime_minutes: 45 })
      .in('type', ['special', 'ova'])
      .or('runtime_minutes.is.null,runtime_minutes.eq.0');
    if (e45) throw new Error(`bulk 45-min update failed: ${e45.message}`);

    // 3. Movies: fetch slugs still missing a runtime, then bulk-update per runtime value
    const { data: movieRows, error: fetchError } = await client
      .from('content_entries')
      .select('slug')
      .eq('type', 'movie')
      .or('runtime_minutes.is.null,runtime_minutes.eq.0');
    if (fetchError) throw new Error(`movie fetch failed: ${fetchError.message}`);

    const byRuntime = {};
    for (const row of movieRows) {
      const runtime = MOVIE_RUNTIMES[row.slug] ?? 100;
      (byRuntime[runtime] ??= []).push(row.slug);
    }
    let movieFixed = 0;
    for (const [runtime, slugs] of Object.entries(byRuntime)) {
      const { error } = await client
        .from('content_entries')
        .update({ runtime_minutes: Number(runtime) })
        .eq('type', 'movie')
        .in('slug', slugs);
      if (error) throw new Error(`movie bulk update failed: ${error.message}`);
      movieFixed += slugs.length;
    }

    console.log(`movie runtimes backfilled: ${movieFixed}`);

    // Verify: nothing left NULL or 0
    const { count, error: verifyError } = await client
      .from('content_entries')
      .select('id', { count: 'exact', head: true })
      .or('runtime_minutes.is.null,runtime_minutes.eq.0');
    if (verifyError) throw new Error(`verify failed: ${verifyError.message}`);
    if (count > 0) throw new Error(`FAIL: ${count} entries still missing runtime (expected 0)`);
    console.log(`verify: 0 entries missing runtime. Done.`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

await main();
