-- Migration 024: available-episode franchise totals
--
-- Changes refresh_franchise_episode_totals() to count episodes that are
-- currently available to watch rather than future planned totals.
--
-- Rules per row (applied when aggregating into series_root totals):
--   FINISHED              → full episodes count
--   RELEASING + next_airing_episode known  → next_airing_episode - 1  (aired episodes)
--   RELEASING + next_airing_episode null   → episodes (conservative announced total)
--   NOT_YET_RELEASED      → 0
--   MOVIE format          → excluded at the filter level (never counted)
--   CANCELLED / HIATUS    → episodes as-is (what was produced)
--
-- Does not touch resolve_franchise_roots() or reclassify_catalog().

CREATE OR REPLACE FUNCTION public.refresh_franchise_episode_totals()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- 1) Clear all totals
  update public.anime
  set franchise_episode_total = null;

  -- 2) Standalone episodic works: set own available episode count
  --    Excludes movies (no episode total shown for standalone films).
  update public.anime
  set franchise_episode_total = case
    when status = 'FINISHED'
      then episodes
    when status = 'RELEASING' and next_airing_episode is not null
      then greatest(next_airing_episode - 1, 0)
    when status = 'RELEASING' and next_airing_episode is null
      then episodes   -- conservative: announced total when aired count unknown
    when status = 'NOT_YET_RELEASED'
      then 0
    else
      episodes        -- CANCELLED, HIATUS: use what was produced
  end
  where catalog_type = 'standalone_work'
    and format in ('TV', 'TV_SHORT', 'ONA');

  -- 3) Series roots: sum available episodes across root + all TV-like franchise members.
  --    MOVIE format is excluded by the format filter — never counted toward totals.
  --    NOT_YET_RELEASED rows contribute 0.
  --    Airing rows contribute aired count (next_airing_episode - 1) when available.
  update public.anime root
  set franchise_episode_total = totals.total_eps
  from (
    select
      r.id as root_id,
      sum(
        case
          when a.status = 'NOT_YET_RELEASED'
            then 0
          when a.status = 'FINISHED'
            then coalesce(a.episodes, 0)
          when a.status = 'RELEASING' and a.next_airing_episode is not null
            then greatest(a.next_airing_episode - 1, 0)
          when a.status = 'RELEASING' and a.next_airing_episode is null
            then coalesce(a.episodes, 0)  -- conservative fallback
          else
            coalesce(a.episodes, 0)       -- CANCELLED, HIATUS
        end
      ) as total_eps
    from public.anime r
    join public.anime a
      on a.id = r.id
      or a.franchise_root_id = r.id
    where r.catalog_type = 'series_root'
      and a.format in ('TV', 'TV_SHORT', 'ONA')
    group by r.id
  ) totals
  where root.id = totals.root_id;

  -- 4) Children never display totals
  update public.anime
  set franchise_episode_total = null
  where catalog_type = 'franchise_child';
end;
$function$;

select public.refresh_catalog();
