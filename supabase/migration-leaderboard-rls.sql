-- ─────────────────────────────────────────────────────────────
-- WATCH_STATUS PUBLIC READ RLS POLICY
-- Allows all users (anon & authenticated) to read watch status rows
-- so community leaderboards, rankings, and public detective dossiers
-- accurately aggregate and display progress across all users.
-- Insert/Update/Delete operations remain strictly owner-only.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Users can view own watch status" on public.watch_status;
drop policy if exists "Watch status is publicly readable" on public.watch_status;

create policy "Watch status is publicly readable"
  on public.watch_status for select
  using (true);
