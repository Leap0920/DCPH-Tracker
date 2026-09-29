# Google sign-in — implementation plan

Status: **not implemented.** This is the plan for adding a "Continue with Google"
button next to the current email-OTP sign-up. Written 2026-09-27.

Auth today is Supabase Auth via `@supabase/ssr`: sign-up collects a display name
and email, sends a 6-digit code (`app/api/auth/otp/route.ts`), then the client
sets a password (`components/auth/AuthModal.tsx`). Google sign-in replaces the
code step with Google's own verification.

## Why this is mostly configuration

Most of the plumbing an OAuth login needs already exists:

- `app/(auth)/callback/route.ts` already handles `?code=` with
  `exchangeCodeForSession(code)` — that is the exact exchange Google OAuth
  returns with. It is rate-limited and sanitizes the `next` parameter.
- `utils/supabase/middleware.ts` sets `sameSite: "lax"` deliberately, with a
  comment noting that `strict` breaks OAuth callbacks. The PKCE code verifier
  cookie survives the round trip.
- `handle_new_user()` (`supabase/schema.sql:260`) creates the profile row for any
  new auth user, so a Google user gets a row automatically.
- `/api/proxy-image` exists and the CSP already allows `https:` images, so Google
  profile pictures render — including inside the wrapped card, where a
  cross-origin avatar would otherwise taint the canvas export.
- No CSP change is needed: the OAuth hop is a top-level navigation, which
  `form-action` / `connect-src` do not govern.

## Fix first: username collisions (blocker)

`profiles.username` is `unique not null` (`supabase/schema.sql:31`) and the
trigger falls back to `split_part(new.email, '@', 1)` (`supabase/schema.sql:266`).
Google sends **no** `username` in metadata, so `carlo@gmail.com` signing up while
`carlo` already exists violates the unique constraint *inside the auth insert* —
the whole sign-up fails with a database error, not a friendly message.

`app/api/auth/otp/route.ts` already works around this with its own uniqueness
loop and passes a free username in metadata. The trigger needs the same
guarantee, because Google metadata cannot supply one.

Google also sends `full_name`, `name` and `picture`/`avatar_url` rather than
`display_name`, so without a trigger change a Google user would land with the
email prefix as their display name and no avatar.

## 1. Dashboard work (needs your Google account, cannot be automated)

1. **Google Cloud Console** → APIs & Services → Credentials → Create OAuth client
   ID → *Web application*. Authorized redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback`
   Scopes: `openid`, `email`, `profile`. Fill in the consent screen (app name,
   support email). Test users are enough while the app is unpublished.
2. **Supabase** → Authentication → Providers → Google → paste the client ID and
   secret, enable the provider.
3. **Supabase** → Authentication → URL Configuration → Redirect URLs: add
   `https://dcphtracker.vercel.app/auth/callback`,
   `http://localhost:3000/auth/callback`, and — if the LAN address is used for
   device testing — `http://192.168.254.153:3000/auth/callback`.
   Add the plain site URL under Site URL as well.

## 2. Migration (`supabase/migration-google-signin.sql`)

Run after `migration-security-hardening-2.sql`. The insert stays permitted
because `handle_new_user()` is `security definer` and runs as the owner, which
the escalation-prevention trigger allows (`current_user in ('postgres',
'service_role','supabase_admin')`).

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base_username text;
  candidate text;
  suffix integer := 0;
begin
  -- Prefer the username our OTP route generated; otherwise derive one from the
  -- Google profile name, then from the address.
  base_username := coalesce(
    nullif(meta ->> 'username', ''),
    nullif(regexp_replace(lower(split_part(coalesce(meta ->> 'full_name', meta ->> 'name', ''), ' ', 1)), '[^a-z0-9_-]', '', 'g'), ''),
    nullif(regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9_-]', '', 'g'), ''),
    'detective'
  );
  base_username := left(base_username, 15);
  candidate := base_username;

  -- profiles.username is unique not null, so an OAuth signup must never assume
  -- the derived name is free.
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    if suffix > 20 then
      candidate := left(base_username, 8) || substr(md5(random()::text), 1, 6);
      exit;
    end if;
    candidate := left(base_username, 11) || lpad(suffix::text, 4, '0');
  end loop;

  insert into public.profiles (user_id, username, display_name, avatar_url, birthday)
  values (
    new.id,
    candidate,
    coalesce(
      nullif(meta ->> 'display_name', ''),
      nullif(meta ->> 'full_name', ''),
      nullif(meta ->> 'name', ''),
      candidate
    ),
    coalesce(nullif(meta ->> 'avatar_url', ''), nullif(meta ->> 'picture', '')),
    nullif(meta ->> 'birthday', '')::date
  );
  return new;
end;
$$;
```

`avatar_url` is populated for provider sign-ups and stays null for email sign-ups,
which send no picture.

## 3. Code changes

**Button** in `components/auth/AuthModal.tsx`, signup mode (the sign-in tab keeps
username + password). `window.location.origin` keeps localhost, the LAN address
and production working without a hardcoded URL:

```tsx
async function handleGoogleSignIn() {
  setError(null)
  setGoogleLoading(true)
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=/tracker`,
      scopes: "openid email profile",
    },
  })
  // On success the browser leaves the page, so only the failure path resets state.
  if (error) {
    setError(error.message)
    setGoogleLoading(false)
  }
}
```

`/auth/callback` already forwards to `next`, so no callback change is needed.

**Settings.** A Google account has no password identity, so the change-password
form and the reset-password link are dead ends for those users. Read
`user.identities` (or `user.app_metadata.provider`) and hide the password section
when no `email` identity with a password exists.

**Decision — identity linking.** If someone signed up with email OTP and later
clicks Google with the same address, Supabase refuses unless you enable identity
linking for matching emails (Authentication → Providers → "Allow linking
identities with the same email"). Decide deliberately: linking is convenient but
means a Google account can take over an existing email account.

## 4. Verification checklist

- [ ] Google sign-in on a fresh account: profile row created, username not
      colliding with an existing one, avatar_url populated.
- [ ] Collision case: sign up with Google using an address whose derived username
      is already taken — expect a suffixed username, not a 500.
- [ ] Existing email-OTP account + Google on the same address — behaves per the
      linking decision above.
- [ ] `next=/tracker` honoured after the callback; a tampered `next=//evil.com`
      is rejected (the route already guards this).
- [ ] Avatar renders in settings and in the wrapped card export.
- [ ] Failed consent (user cancels) returns to the modal with a readable error.

## Not the same thing: Google Authenticator

"Google Authenticator" (the 6-digit code app) is **Supabase MFA/TOTP** — a second
factor added on top of a login, not a replacement for sign-up. It needs an
enroll/verify UI plus `aal` checks in middleware. Separate piece of work; ask
before starting it.
