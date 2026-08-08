import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required');
  console.error('Run: node --env-file=.env.local scripts/populate-arcs.mjs');
  process.exit(1);
}

// Sign in as demo admin (role='admin' satisfies RLS for content_entries writes)
const client = createClient(url, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Mirrors lib/arcs-guide.ts STORY_ARCS (episodeEnd null -> 1209 = latest episode)
const ARCS = [
  { slug: 'conan-arc', title: 'Conan Arc', description: 'A shrunken detective builds a new life — and a secret mission.', start_episode: 1, end_episode: 128 },
  { slug: 'sherry-arc', title: 'Sherry Arc', description: 'A defector from the Organization joins Conan\'s side.', start_episode: 129, end_episode: 178 },
  { slug: 'vermouth-arc', title: 'Vermouth Arc', description: 'A master of disguise who somehow knows Conan\'s secret.', start_episode: 179, end_episode: 345 },
  { slug: 'cell-phone-arc', title: 'Cell Phone Arc', description: 'Conan gets dangerously close to the boss himself.', start_episode: 346, end_episode: 424 },
  { slug: 'kir-arc', title: 'Kir Arc', description: 'A three-way war between the FBI, the CIA, and the Organization.', start_episode: 425, end_episode: 508 },
  { slug: 'bourbon-arc', title: 'Bourbon Arc', description: 'Who is Bourbon? Three newcomers, one hidden agent.', start_episode: 509, end_episode: 783 },
  { slug: 'rum-arc', title: 'Rum Arc — Scarlet Series', description: 'The hunt for the No. 2 — and the boss is finally named.', start_episode: 784, end_episode: 1209 },
];

async function main() {
  try {
    const { error: signInError } = await client.auth.signInWithPassword({
      email: 'admin@dcph.ph',
      password: 'DcphDemo2026!',
    });
    if (signInError) throw new Error(`admin sign-in failed: ${signInError.message}`);

    // 1. Upsert arcs (idempotent: re-run safe)
    const { error: upsertError } = await client
      .from('arcs')
      .upsert(ARCS, { onConflict: 'slug' });
    if (upsertError) throw new Error(`arcs upsert failed: ${upsertError.message}`);

    // 2. Fetch arc ids by slug
    const { data: arcRows, error: fetchError } = await client
      .from('arcs')
      .select('id, slug');
    if (fetchError) throw new Error(`arcs fetch failed: ${fetchError.message}`);
    const idBySlug = Object.fromEntries(arcRows.map((a) => [a.slug, a.id]));

    // 3. Backfill content_entries.arc_id by episode range
    let updated = 0;
    for (const arc of ARCS) {
      const arcId = idBySlug[arc.slug];
      if (!arcId) throw new Error(`arc ${arc.slug} missing id after upsert`);
      const { data, error } = await client
        .from('content_entries')
        .update({ arc_id: arcId })
        .eq('type', 'episode')
        .gte('episode_number', arc.start_episode)
        .lte('episode_number', arc.end_episode)
        .select('id');
      if (error) throw new Error(`arc_id backfill ${arc.slug} failed: ${error.message}`);
      updated += data?.length ?? 0;
    }
    console.log(`arcs upserted: ${ARCS.length}, content_entries linked: ${updated}`);

    // 4. Verify: no episode should be left with arc_id NULL
    const { count, error: verifyError } = await client
      .from('content_entries')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'episode')
      .is('arc_id', null);
    if (verifyError) throw new Error(`verify failed: ${verifyError.message}`);
    if (count > 0) {
      throw new Error(`FAIL: ${count} episodes still have arc_id NULL (expected 0)`);
    }
    console.log(`verify: 0 episodes without an arc. Done.`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

await main();
