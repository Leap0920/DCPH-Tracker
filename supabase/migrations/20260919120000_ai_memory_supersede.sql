-- supabase/migrations/20260919120000_ai_memory_supersede.sql
--
-- One function: replacing an active memory slot atomically.
--
-- The two-step sequence a caller would otherwise write is impossible against
-- this schema. ai_user_memories_active_slot_idx is a partial unique index on
-- (user_id, kind, key) where status = 'active', so inserting the replacement
-- while the original is still active is rejected; and marking the original
-- first cannot set superseded_by, because the replacement has no id yet.
-- Superseding is therefore three statements in one transaction, in one
-- function: mark the original, insert the replacement, point the original's
-- superseded_by at it. The original row is kept -- a superseded fact is
-- provenance the user can still read back, and the transparency endpoint
-- (§7.4) shows it.
--
-- The function runs as its invoker (the default), so the caller's own
-- privileges decide; service_role is the only role that reaches these tables at
-- all, and the revoke below mirrors the table pattern already applied to
-- ai_user_memories. The migration is additive: create or replace only.

create or replace function public.ai_memory_supersede(
  p_user_id uuid, p_old_id uuid, p_kind text, p_key text, p_value text,
  p_confidence real, p_source_message_id uuid, p_expires_at timestamptz
) returns public.ai_user_memories
language plpgsql volatile
set search_path = public, extensions, pg_temp as $$
declare v_new public.ai_user_memories;
begin
  -- The ownership check and the swap are one statement: another user's id, a
  -- row that is already superseded and a row that never existed all fail the
  -- same way, and none of them is silently treated as a successful replace.
  update public.ai_user_memories
     set status = 'superseded', updated_at = now()
   where id = p_old_id and user_id = p_user_id and status = 'active';
  if not found then
    raise exception 'memory % is not an active fact of this user', p_old_id;
  end if;
  -- The replacement is inserted after the original leaves the active set, which
  -- is what the partial unique index requires; it becomes active in the same
  -- transaction, so a reader never sees the slot empty.
  insert into public.ai_user_memories
    (user_id, kind, key, value, confidence, status, source_message_id, expires_at, last_confirmed_at)
  values (p_user_id, p_kind, p_key, p_value, p_confidence, 'active', p_source_message_id, p_expires_at, now())
  returning * into v_new;
  -- Last, because v_new.id only exists now. `last_confirmed_at` is the
  -- database's now(): a caller's clock could disagree with the row it replaced.
  update public.ai_user_memories
     set superseded_by = v_new.id, updated_at = now()
   where id = p_old_id and user_id = p_user_id;
  return v_new;
end; $$;

revoke all on function public.ai_memory_supersede(uuid, uuid, text, text, text, real, uuid, timestamptz)
  from anon, authenticated;
