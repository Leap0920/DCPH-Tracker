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

// Real theatrical runtimes (minutes) for the 29 main movies, by movie_number.
// Source: Detective Conan World "Regular movies", re-checked 2026-09-27.
// Keyed by number, not slug: the movie slugs were renumbered (mov-53…mov-64 for
// 2003-2009) by supabase/migration-movie-renumber.sql, so slug keys went stale.
const MOVIE_RUNTIMES = {
  1: 95, 2: 100, 3: 100, 4: 100, 5: 100, 6: 108, 7: 108, 8: 109, 9: 108,
  10: 111, 11: 107, 12: 116, 13: 112, 14: 103, 15: 110, 16: 111, 17: 111,
  18: 111, 19: 113, 20: 112, 21: 112, 22: 111, 23: 110, 24: 111, 25: 111,
  26: 110, 27: 111, 28: 110, 29: 110, // M29 runtime is unannounced; 110 is the series norm.
};

async function main() {
  try {
    const { error: signInError } = await client.auth.signInWithPassword({
      email: 'admin@dcph.ph',
      password: 'DcphDemo2026!',
    });
    if (signInError) throw new Error(`admin sign-in failed: ${signInError.message}`);

    // 1. Bulk: standard-length types, each with its own default. Hannin no
    // Hanzawa-san is a 10-minute short and Zero's Tea Time a 15-minute ONA
    // (AniList); live_action rows are set individually below.
    const TYPE_DEFAULTS = [
      ['episode', 25],
      ['ova', 25],
      ['special', 46],
      ['magic_kaito', 24],
      ['hanzawa', 10],
      ['zero_tea_time', 15],
      ['live_action', 46],
    ];
    for (const [type, minutes] of TYPE_DEFAULTS) {
      const { error } = await client
        .from('content_entries')
        .update({ runtime_minutes: minutes })
        .eq('type', type)
        .or('runtime_minutes.is.null,runtime_minutes.eq.0');
      if (error) throw new Error(`bulk ${type} update failed: ${error.message}`);
    }

    // 2. Live action: four TV specials at 104-108 (ja.wikipedia 放送分) and the
    // 2011 series at 40 per episode, with grouped rows carrying the group total.
    const LIVE_ACTION_RUNTIMES = {
      'la-live-action-drama-special-01': 108,
      'la-live-action-drama-special-02': 108,
      'la-live-action-drama-special-03': 104,
      'la-live-action-drama-special-04': 108,
      'la-live-action-drama-episode-01-02': 80,
      'la-live-action-drama-episode-03': 40,
      'la-live-action-drama-episodes-04-07': 160,
      'la-live-action-drama-episodes-08-09': 80,
      'la-live-action-drama-episodes-10-11': 80,
      'la-live-action-drama-episode-12-13': 80,
      'drama-episode-11': 40,
      'drama-episode-12': 40,
      'drama-episode-13': 40,
    };
    for (const [slug, runtime] of Object.entries(LIVE_ACTION_RUNTIMES)) {
      const { error } = await client
        .from('content_entries')
        .update({ runtime_minutes: runtime })
        .eq('slug', slug)
        .or('runtime_minutes.is.null,runtime_minutes.eq.0');
      if (error) throw new Error(`live_action ${slug} update failed: ${error.message}`);
    }

    // 3. Movies: fetch rows still missing a runtime, then bulk-update per value
    const { data: movieRows, error: fetchError } = await client
      .from('content_entries')
      .select('slug,movie_number')
      .eq('type', 'movie')
      .or('runtime_minutes.is.null,runtime_minutes.eq.0');
    if (fetchError) throw new Error(`movie fetch failed: ${fetchError.message}`);

    const byRuntime = {};
    for (const row of movieRows) {
      // Compilations and crossovers are not in the numbered list; 110 is the
      // franchise norm and is what the row already implies.
      const runtime = MOVIE_RUNTIMES[row.movie_number] ?? 110;
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
