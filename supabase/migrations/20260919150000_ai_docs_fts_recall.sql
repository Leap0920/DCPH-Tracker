-- ============================================================================
-- Full-text recall: ai_docs_fts matched nothing for an ordinarily-phrased
-- question, so the round failed silently and the ladder answered from noise.
--
-- WHAT WAS WRONG. The RPC built its tsquery with websearch_to_tsquery, which
-- ANDs the query's terms: a document had to contain *every* content word of the
-- question to be a hit at all. "Who was the victim in the Til Death Do Us Part
-- case?" matched, because each of its words happens to appear in that case
-- record. "What happened in the Til Death Do Us Part case?" returned 0 rows --
-- the word "happened" is in no document -- and "Tell me about the Til Death Do
-- Us Part case" returned 0 rows for the word "tell". Recall therefore depended
-- on the user reusing the document's own wording, which is the one thing a
-- question does not do.
--
-- MEASURED. lib/__tests__/retrieval-eval.test.ts holds 60 golden questions and
-- a recall@5 gate of 0.85. The in-process source that eval runs against
-- approximates these three branches rather than calling them, so the gate had
-- never been checked against this database. Replayed against it, the old
-- function scored 47/60 = 0.783 and the misses came in two shapes: an fts round
-- that returned 0 rows for a naturally-phrased question ("What happens in
-- Roller Coaster Murder Case?" -- the word "happens" is in no document), and a
-- document that the fts round did find but that then lost the ranking to a case
-- record naming the same title.
--
-- WHAT REPLACES IT. The same lexemes, OR'd instead of AND'd. ts_rank_cd
-- already rewards a document that covers more of the query and holds those
-- terms closer together, so precision comes from the ranking instead of from
-- excluding documents, and recall no longer depends on phrasing. On the same 60
-- questions this change alone moves recall@5 from 0.783 to 0.800; the second
-- shape of miss is the scorer's, and the two bonuses added to `scoreEntry` in
-- lib/chat/query.ts alongside this migration are what lift it to 0.950.
--
-- Two details the OR query has to get right, both load-bearing:
--
--   * The lexemes come from to_tsvector, so they are already stemmed and are
--     NOT re-parsed by to_tsquery. Re-stemming is not idempotent -- of the 9481
--     distinct lexemes in this corpus, 403 change ('fals' -> 'fal', 'univers'
--     -> 'univ', 'high-rank' -> 'high-rank' <-> 'high' <-> 'rank') -- and a
--     changed lexeme matches nothing. `quote_literal(lexeme)::tsquery` casts
--     each one literally, and lexemes never contain a quote to escape because
--     the parser splits on it ("O'Brien" tokenizes to 'o' and 'brien').
--   * An empty or stopword-only query yields an empty tsquery, which matches
--     nothing and raises nothing. That is the same property the old comment
--     relied on, so a user's raw question is still safe to hand to the
--     database unvalidated.
-- ============================================================================

create or replace function public.ai_docs_fts(p_query text, p_limit int)
returns table (id text, rank real)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with q as (
    select coalesce(
      string_agg(quote_literal(lexeme), ' | ' order by lexeme),
      ''
    )::tsquery as query
    from unnest(
      tsvector_to_array(to_tsvector('english'::regconfig, coalesce(p_query, '')))
    ) as t(lexeme)
  )
  select d.id, ts_rank_cd(d.fts, q.query)::real as rank
  from public.ai_documents as d, q
  where d.fts @@ q.query
  order by rank desc, d.id
  limit p_limit;
$$;

comment on function public.ai_docs_fts(text, int) is
  'R2 full-text retrieval. The query''s lexemes are OR''d, not AND''d: a document no longer has to contain every content word of the question to be a candidate, and ts_rank_cd ranks by coverage and proximity.';

-- Verify (all four must return the case document first, where the AND form
-- returned 3, 2, 0 and 0 rows respectively):
--   select * from public.ai_docs_fts('Til Death Do Us Part', 5);
--   select * from public.ai_docs_fts('Who was the victim in the Til Death Do Us Part case?', 5);
--   select * from public.ai_docs_fts('Tell me about the Til Death Do Us Part case', 5);
--   select * from public.ai_docs_fts('What happened in the Til Death Do Us Part case?', 5);
