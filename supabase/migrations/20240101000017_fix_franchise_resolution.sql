-- =============================================================================
-- Migration: fix_franchise_resolution
--
-- Fixes two gaps in the catalog pipeline:
--
-- Gap 1 — resolve_franchise_roots() misses entries where prequel_anilist_id
--   is NULL.  This happens for rows seeded before migration 015 added that
--   column, and for any future entry whose AniList prequel is outside the
--   current fetch window.
--
--   Fix: Step 4 — title-prefix colon fallback.
--   For canonical TV entries still unresolved after Steps 2–3, check whether
--   their title begins with another canonical TV entry's title followed by a
--   colon (minimum 6 chars, earlier season_year).  This catches:
--     "Dr. STONE: Stone Wars"           → Dr. STONE  ✓
--     "Dr. STONE: New World"            → Dr. STONE  ✓
--     "Kaguya-sama: Love Is War - ..."  → Kaguya-sama: Love Is War  ✓
--     "Horimiya: The Missing Pieces"    → Horimiya  ✓
--   DISTINCT ON picks the most-recent preceding canonical if multiple
--   prefixes match (rare edge case).
--   Step 5 re-runs chain propagation in case Step 4 introduced intermediate
--   nodes.
--
-- Gap 2 — seed script only writes prequel_anilist_id for entries it directly
--   fetches.  When an entry (e.g. Dr. STONE) has SEQUEL edges in AniList,
--   those sequel entries' prequel_anilist_id should be backfilled even if the
--   sequels are already in the DB from a prior run.
--
--   Fix: backfill_prequel_from_edges(edges jsonb)
--   Accepts an array of {anilist_id, prequel_anilist_id} pairs collected from
--   the reverse direction (SEQUEL edges of fetched entries) and writes
--   prequel_anilist_id for matching DB rows where it is currently NULL.
--   Called by the seed script as Phase 1.5, before refresh_catalog().
-- =============================================================================

-- =============================================================================
-- Part 1 — Enhanced resolve_franchise_roots()
-- Replaces the version in migration 015.
-- =============================================================================

create or replace function public.resolve_franchise_roots()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

  -- Step 1: Reset franchise_root_id (idempotent).
  -- The anime_set_canonical() trigger fires per-row, falling through to
  -- label-pattern checks which re-apply Class 1 correctly on the cleared rows.
  update public.anime
  set    franchise_root_id = null
  where  franchise_root_id is not null;

  -- Step 2: One-hop resolution via prequel_anilist_id.
  -- For every entry whose prequel_anilist_id matches a row in the DB,
  -- set franchise_root_id = that row's UUID.
  -- The anime_set_canonical() trigger fires and sets is_canonical = false.
  update public.anime as a
  set    franchise_root_id = p.id
  from   public.anime as p
  where  a.prequel_anilist_id = p.anilist_id
    and  p.anilist_id is not null;

  -- Step 3: Chain propagation — redirect intermediate nodes to ultimate root.
  -- Each iteration resolves one additional level of depth.
  for _depth in 1..10 loop
    update public.anime as a
    set    franchise_root_id = p.franchise_root_id
    from   public.anime as p
    where  a.franchise_root_id  = p.id
      and  p.franchise_root_id is not null;

    exit when not found;
  end loop;

  -- -----------------------------------------------------------------------
  -- Step 4: Title-prefix colon fallback.
  --
  -- For canonical TV entries STILL unresolved (prequel_anilist_id was NULL —
  -- e.g. rows seeded before migration 015), check whether their title begins
  -- with another canonical TV entry's title followed by a colon.
  --
  -- Examples:
  --   "Dr. STONE: New World"  LIKE "Dr. STONE" || ':%'     → root = Dr. STONE
  --   "Horimiya: The Missing Pieces"  LIKE "Horimiya" || ':%' → root = Horimiya
  --
  -- DISTINCT ON (a.id) picks ONE root per sequel — the most recent predecessor
  -- (highest season_year still less than the sequel's year) — so if two
  -- canonical entries share a common colon-prefix, the closer one wins.
  -- -----------------------------------------------------------------------

  with best_root as (
    select distinct on (a.id)
           a.id  as sequel_id,
           r.id  as root_id
    from   public.anime as a
    join   public.anime as r
             on  r.format in ('TV', 'TV_SHORT')
             and r.is_canonical = true    -- only true roots (trigger ensures root_id IS NULL when canonical)
             and r.id != a.id
             and coalesce(r.season_year, 9999) < coalesce(a.season_year, 9999)
             and (
                   -- English title: sequel starts with root title + colon
                   (     r.title_english is not null
                     and char_length(r.title_english) >= 6
                     and lower(coalesce(a.title_english, ''))
                         like lower(r.title_english) || ':%'
                   )
                   or
                   -- Romaji title: same check
                   (     r.title_romaji is not null
                     and char_length(r.title_romaji) >= 6
                     and lower(coalesce(a.title_romaji, ''))
                         like lower(r.title_romaji) || ':%'
                   )
                 )
    where  a.format in ('TV', 'TV_SHORT')
      and  a.is_canonical     = true   -- not yet folded
      and  a.franchise_root_id is null  -- not yet resolved
    order  by a.id,
              coalesce(r.season_year, 0) desc,  -- prefer most-recent predecessor
              r.anilist_id asc                   -- tiebreak: lower (older) anilist_id
  )
  update public.anime as a
  set    franchise_root_id = br.root_id
  from   best_root as br
  where  a.id = br.sequel_id;

  -- Step 5: Re-propagate after Step 4 in case newly set roots are themselves
  -- intermediate nodes (Step 4 may point a sequel at a non-root).
  for _depth in 1..10 loop
    update public.anime as a
    set    franchise_root_id = p.franchise_root_id
    from   public.anime as p
    where  a.franchise_root_id  = p.id
      and  p.franchise_root_id is not null;

    exit when not found;
  end loop;

end;
$$;

comment on function public.resolve_franchise_roots() is
  'Resolves franchise_root_id for all anime rows.
   Steps 1–3: explicit prequel_anilist_id chains (AniList relation data).
   Step 4:    title-prefix colon fallback for rows missing prequel_anilist_id
              (e.g. seeded before migration 015).
   Step 5:    re-propagates chains introduced by Step 4.
   Idempotent — safe to call multiple times.';

-- =============================================================================
-- Part 2 — backfill_prequel_from_edges()
--
-- Accepts an array of {anilist_id, prequel_anilist_id} pairs derived from
-- the SEQUEL edges of entries fetched in the current seed run.
-- Updates prequel_anilist_id for matching DB rows that currently have NULL,
-- so that resolve_franchise_roots() Steps 2–3 can follow them explicitly
-- rather than falling back to the title-prefix heuristic.
--
-- Called by the seed script (Phase 1.5) before refresh_catalog().
-- =============================================================================

create or replace function public.backfill_prequel_from_edges(
  edges jsonb   -- array of {anilist_id: int, prequel_anilist_id: int}
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.anime as a
  set    prequel_anilist_id = (e.prequel_anilist_id)::integer
  from   jsonb_to_recordset(edges) as e(anilist_id integer, prequel_anilist_id integer)
  where  a.anilist_id = e.anilist_id
    and  a.prequel_anilist_id is null;   -- never overwrite an explicit value
$$;

comment on function public.backfill_prequel_from_edges(jsonb) is
  'Writes prequel_anilist_id for DB rows currently missing it, using reverse-
   direction SEQUEL edges collected by the seed script.  Only fills NULL values.
   Call before refresh_catalog() so resolve_franchise_roots() can use the data.';

-- =============================================================================
-- Part 3 — Immediate cleanup pass
-- Re-runs the full catalog pipeline using the enhanced resolve_franchise_roots().
-- =============================================================================

select public.refresh_catalog();
