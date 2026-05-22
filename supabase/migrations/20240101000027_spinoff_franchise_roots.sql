-- =============================================================================
-- Migration 027 — spinoff franchise root linking
--
-- Adds backfill_spinoff_roots(edges jsonb): accepts {spinoff_anilist_id, parent_anilist_id}
-- pairs collected from AniList SPIN_OFF / SIDE_STORY relation edges and writes
-- franchise_root_id on spinoff entries so reclassify_catalog() can hide them.
--
-- Called by refresh-anime.ts after prequel backfill, before refresh_catalog().
-- =============================================================================

create or replace function public.backfill_spinoff_roots(
  edges jsonb  -- array of {spinoff_anilist_id: int, parent_anilist_id: int}
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.anime as spinoff
  set    franchise_root_id = coalesce(parent.franchise_root_id, parent.id)
  from   jsonb_to_recordset(edges) as e(spinoff_anilist_id integer, parent_anilist_id integer),
         public.anime as parent
  where  spinoff.anilist_id = e.spinoff_anilist_id
    and  parent.anilist_id  = e.parent_anilist_id
    and  spinoff.franchise_root_id is null
    and  spinoff.id <> coalesce(parent.franchise_root_id, parent.id);
$$;

comment on function public.backfill_spinoff_roots(jsonb) is
  'Sets franchise_root_id for spinoff/side-story entries using AniList relation edges.
   Edges: [{spinoff_anilist_id, parent_anilist_id}].
   Sets spinoff.franchise_root_id = parent.franchise_root_id ?? parent.id.
   Only fills NULL values — never overwrites explicit prequel chains.
   Call before refresh_catalog() so reclassify_catalog() hides them as franchise_child.';
