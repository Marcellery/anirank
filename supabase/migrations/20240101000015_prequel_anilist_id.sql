-- =============================================================================
-- Migration: prequel_anilist_id (Milestone 3 — DB-native franchise resolution)
--
-- Root cause of franchise collapsing failures:
--   The seed script's Phase 2 resolved franchise chains in TypeScript memory,
--   operating only on the entries fetched in *that* run (top 300 by popularity).
--   Any row already in the DB from a previous seed that fell outside the current
--   top-300 window was never visited and kept is_canonical = true.
--
-- Fix:
--   Store the direct predecessor's AniList ID (prequel_anilist_id) on each row
--   during Phase 1 — while we already have the AniList relations data in hand.
--   Then resolve franchise roots entirely in SQL via resolve_franchise_roots(),
--   which follows prequel_anilist_id chains for EVERY row in the DB, not just
--   the ones fetched in the current run.
--
-- Dependency on migration 013:
--   franchise_root_id column and the anime_set_canonical() trigger (which marks
--   rows with franchise_root_id IS NOT NULL as is_canonical = false) must already
--   exist.  Run 013 before this migration.
-- =============================================================================

-- =============================================================================
-- Part 1 — prequel_anilist_id column
-- =============================================================================

alter table public.anime
  add column if not exists prequel_anilist_id integer;

comment on column public.anime.prequel_anilist_id is
  'AniList media ID of the IMMEDIATE TV predecessor in the franchise chain.
   NULL means this entry is a franchise root (no prior season) or the
   predecessor is unknown.  Set by the seed script from AniList relations.
   Used by resolve_franchise_roots() to resolve franchise_root_id entirely
   in SQL without TypeScript chain traversal.';

create index if not exists anime_prequel_anilist_id_idx
  on public.anime (prequel_anilist_id)
  where prequel_anilist_id is not null;

-- =============================================================================
-- Part 2 — resolve_franchise_roots()
--
-- Follows prequel_anilist_id chains for every row in the DB and writes
-- franchise_root_id to the UUID of the chain's root entry.
--
-- Algorithm (iterative, up to 10 depth levels):
--   Step 1: Reset franchise_root_id on all rows so the function is idempotent.
--   Step 2: Initial pass — for each entry with a known prequel in the DB, set
--           franchise_root_id = that prequel's UUID and is_canonical = false.
--           After this pass, 2-level chains are fully resolved; deeper chains
--           have franchise_root_id pointing to the wrong intermediate node.
--   Step 3: Propagation loop — for each entry whose franchise_root_id points
--           to a non-root (i.e., that node also has a franchise_root_id), update
--           to point to that node's root.  Repeat until stable.
--
-- Example — Dr. STONE franchise:
--   prequel_anilist_id values after seeding:
--     Dr. STONE            → null  (root)
--     Dr. STONE: Stone Wars → Dr. STONE's anilist_id
--     Dr. STONE: New World  → Stone Wars' anilist_id
--
--   After Step 2:
--     Stone Wars → franchise_root_id = Dr. STONE's UUID  ✓
--     New World  → franchise_root_id = Stone Wars' UUID  (intermediate, wrong)
--
--   After Step 3 (one iteration):
--     New World  → franchise_root_id = Dr. STONE's UUID  ✓
-- =============================================================================

create or replace function public.resolve_franchise_roots()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

  -- Step 1: Reset so the function is fully idempotent.
  -- The anime_set_canonical() trigger fires here on franchise_root_id = null,
  -- falling through to label-pattern checks which re-apply Class 1 correctly.
  update public.anime
  set    franchise_root_id = null
  where  franchise_root_id is not null;

  -- Step 2: One-level initial pass.
  -- For every entry whose prequel_anilist_id matches a DB row,
  -- set franchise_root_id = that row's UUID.
  -- The anime_set_canonical() trigger fires and sets is_canonical = false.
  update public.anime as a
  set    franchise_root_id = p.id
  from   public.anime as p
  where  a.prequel_anilist_id = p.anilist_id
    and  p.anilist_id is not null;

  -- Step 3: Propagation loop — walk entries whose franchise_root_id points to
  -- a non-root node and redirect them to the ultimate root.
  -- Each iteration resolves one additional level of depth.
  -- EXIT WHEN NOT FOUND terminates as soon as no rows are updated.
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
  'Resolves franchise_root_id for all anime rows using prequel_anilist_id chains.
   Covers every DB row regardless of whether it was fetched in the current seed
   run.  Idempotent — safe to call multiple times.
   Call after the seed script has written prequel_anilist_id values.';

-- =============================================================================
-- Part 3 — Initial resolution pass
-- (runs immediately; covers any existing rows that already have
--  prequel_anilist_id set from a prior seed — typically none on first run)
-- =============================================================================

select public.resolve_franchise_roots();
