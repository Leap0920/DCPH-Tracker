-- supabase/migrations/20260919130000_ai_request_log_pipeline.sql
--
-- Plan 4: the agentic pipeline's decisions, recorded per request.
--
-- Three columns, all nullable, with no value supplied for the rows that already
-- exist. They are nullable because every row written before the pipeline
-- shipped has no value for them: a backfilled constant would record a decision
-- no request made, and the table's own history must not refuse the extension.
-- Nothing here rewrites a row -- adding a nullable column to a live table is a
-- metadata-only change.
--
--   plan_source     which planner produced the plan: "router", "model" or "fallback"
--   tools           the tools the plan actually dispatched, in execution order
--   citations_valid whether the answer's [E#] citations all resolved to evidence
--
-- This file carries no access-control statement of any kind: 20260919090000
-- already enables RLS on this table with no policies and removes
-- anon/authenticated reach from it. Restating either here -- above all a new
-- privilege on the table -- is how an additive migration accidentally widens a
-- table that only service_role may touch.

alter table public.ai_request_log
  add column if not exists plan_source     text,
  add column if not exists tools           text[],
  add column if not exists citations_valid boolean;
