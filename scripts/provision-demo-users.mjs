import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  console.error('Run: node --env-file=.env.local scripts/provision-demo-users.mjs');
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_ACCOUNTS = [
  { email: 'admin@dcph.ph', password: 'DcphDemo2026!', username: 'demo_admin', display_name: 'Demo Admin', role: 'admin' },
  { email: 'member@dcph.ph', password: 'DcphDemo2026!', username: 'demo_member', display_name: 'Demo Member', role: 'member' },
];

async function findUserByEmail(email) {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => u.email === email);
    if (found) return found;
    if (data.users.length < 1000 || page >= 100) return null;
    page++;
  }
}

async function deleteUserIfExists(email) {
  const user = await findUserByEmail(email);
  if (!user) return false;
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) throw new Error(`deleteUser ${email} failed: ${error.message}`);
  return true;
}

async function createDemoUser(account) {
  const existed = await deleteUserIfExists(account.email);
  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { username: account.username, display_name: account.display_name },
  });
  if (error) throw new Error(`createUser ${account.email} failed: ${error.message}`);
  const userId = data.user.id;

  const { error: upsertError } = await admin
    .from('profiles')
    .upsert(
      { user_id: userId, username: account.username, display_name: account.display_name, role: account.role },
      { onConflict: 'user_id' }
    );
  if (upsertError) throw new Error(`profile upsert ${account.email} failed: ${upsertError.message}`);

  console.log(`${account.email} -> ${existed ? 'recreated' : 'created'} (user_id: ${userId}, role: ${account.role})`);
}

async function main() {
  try {
    for (const account of DEMO_ACCOUNTS) {
      await createDemoUser(account);
    }
    const probeDeleted = await deleteUserIfExists('probe@test.com');
    console.log(`probe@test.com -> ${probeDeleted ? 'deleted' : 'not found (already gone)'}`);
    console.log('Done. Demo accounts are ready to log in.');
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

await main();
