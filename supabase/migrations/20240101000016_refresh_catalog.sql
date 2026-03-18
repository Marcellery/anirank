-- =============================================================================
-- Migration: refresh_catalog (automatic catalog pipeline)
--
-- Packages all post-import cleanup into a single idempotent function so that
-- any import path (first seed, reseed, partial import, scheduled sync) ends with
-- a clean, fully-normalised catalog — no manual rescue steps required.
--
-- Functions defined here:
--
--   deduplicate_canonical_tv()
--     Removes same-title duplicate canonical TV/TV_SHORT entries.  Runs AFTER
--     resolve_franchise_roots() so that relation-resolved sequels are already
--     non-canonical and won't accidentally win the tiebreak.
--
--   refresh_title_normalized()
--     Fills any NULL title_normalized values.  Handles rows created before
--     migration 014, or any edge case where the per-row trigger misfired.
--
--   refresh_catalog()
--     Master orchestrator.  Call once after any import batch.  Steps:
--       1. resolve_franchise_roots()          (migration 015)
--       2. deduplicate_canonical_tv()         (this migration)
--       3. refresh_franchise_episode_totals() (migration 013)
--       4. refresh_title_normalized()         (this migration)
--
-- Dependencies (must be applied first):
--   013_franchise_root_id.sql       — franchise_root_id column,
--                                     refresh_franchise_episode_totals()
--   014_normalized_search.sql       — title_normalized column, normalize_title()
--   015_prequel_anilist_id.sql      — prequel_anilist_id column,
--                                     resolve_franchise_roots()
-- =============================================================================

-- =============================================================================
-- 1. deduplicate_canonical_tv()
--
-- When two canonical TV/TV_SHORT rows share the same resolved display title
-- (coalesce of title_english, title_romaji, legacy title), the "loser" is
-- marked is_canonical = false.
--
-- Winner selection (first match wins):
--   a. Earlier season_year  (NULL treated as 9999 — pushed to end)
--   b. AniList row (anilist_id NOT NULL) beats a manually-created row (NULL)
--   c. Lower anilist_id (older, more canonical entry)
--
-- Safe to run multiple times: WHERE is_canonical = true ensures already-deduped
-- rows are skipped on subsequent calls.
-- =============================================================================

create or replace function public.deduplicate_canonical_tv()
returns void
language sql
security definer
set search_path = public
as $$
  update public.anime as a
  set    is_canonical = false
  where  a.format in ('TV', 'TV_SHORT')
    and  a.is_canonical = true
    and  exists (
           select 1
           from   public.anime as b
           where  b.format in ('TV', 'TV_SHORT')
             and  b.is_canonical = true
             and  b.id != a.id
             -- same resolved display title
             and  lower(coalesce(a.title_english, a.title_romaji, a.title))
                  = lower(coalesce(b.title_english, b.title_romaji, b.title))
             -- b is the preferred (winning) entry
             and  (
                    -- a. b has an earlier season_year
                    coalesce(b.season_year, 9999) < coalesce(a.season_year, 9999)
                    or
                    -- b. same year: b has a real anilist_id, a was manually created
                    (     coalesce(b.season_year, 9999) = coalesce(a.season_year, 9999)
                      and b.anilist_id is not null
                      and a.anilist_id is null
                    )
                    or
                    -- c. same year, both AniList: keep the lower (older) anilist_id
                    (     coalesce(b.season_year, 9999) = coalesce(a.season_year, 9999)
                      and b.anilist_id is not null
                      and a.anilist_id is not null
                      and b.anilist_id < a.anilist_id
                    )
                  )
         );
$$;

comment on function public.deduplicate_canonical_tv() is
  'Removes same-title duplicate canonical TV entries, keeping the earliest /
   most authoritative (lowest anilist_id) row.  Call after resolve_franchise_roots()
   so relation-resolved sequels are already non-canonical.  Idempotent.';

-- =============================================================================
-- 2. refresh_title_normalized()
--
-- Fills NULL title_normalized values using the same formula as the
-- set_anime_title_normalized trigger.  Covers rows inserted before migration 014
-- or any edge case where the trigger did not fire.
-- =============================================================================

create or replace function public.refresh_title_normalized()
returns void
language sql
security definer
set search_path = public
as $$
  update public.anime
  set    title_normalized = public.normalize_title(
           coalesce(title_english, '') || ' ' ||
           coalesce(title_romaji,  '') || ' ' ||
           title
         )
  where  title_normalized is null;
$$;

comment on function public.refresh_title_normalized() is
  'Fills NULL title_normalized values.  The per-row trigger handles ongoing writes;
   this function is a safety net for legacy rows and edge cases.  Idempotent.';

-- =============================================================================
-- 3. refresh_catalog()
--
-- Single entry point for the full automatic catalog pipeline.
-- Called by the seed script after every import batch.
-- Also usable for scheduled syncs or manual repair.
--
-- Pipeline order is intentional:
--   Step 1 must run before Step 2 so that relation-sequels are already
--   non-canonical before the title-dedup pass evaluates remaining candidates.
--   Step 3 must run after Steps 1–2 so episode totals reflect the final
--   canonical assignments.
--   Step 4 is a repair step; order relative to the others does not matter.
-- =============================================================================

create or replace function public.refresh_catalog()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Step 1: follow prequel_anilist_id chains for EVERY DB row, set franchise_root_id.
  --         The anime_set_canonical() trigger fires per-row and marks
  --         franchise_root_id IS NOT NULL rows as is_canonical = false.
  perform public.resolve_franchise_roots();

  -- Step 2: deduplicate canonical TV entries that share the same display title
  --         but were not caught by label patterns or relation resolution
  --         (e.g. two rows both called "Attack on Titan" from different imports).
  perform public.deduplicate_canonical_tv();

  -- Step 3: recompute franchise_episode_total now that franchise_root_id is final.
  perform public.refresh_franchise_episode_totals();

  -- Step 4: fill any NULL title_normalized values missed by the per-row trigger.
  perform public.refresh_title_normalized();
end;
$$;

comment on function public.refresh_catalog() is
  'Full automatic catalog pipeline.  Safe to call after any import batch
   (first seed, reseed, partial import, scheduled sync).  Idempotent.

   Pipeline:
     1. resolve_franchise_roots()          — franchise chain resolution (all DB rows)
     2. deduplicate_canonical_tv()         — remove same-title TV duplicates
     3. refresh_franchise_episode_totals() — recompute per-franchise episode totals
     4. refresh_title_normalized()         — repair any NULL search index values';

-- =============================================================================
-- 4. Initial run
-- Cleans up any existing rows that arrived before this migration was applied.
-- =============================================================================

select public.refresh_catalog();
