-- =============================================================================
-- Migration: sync_metadata (020)
--
-- Enables live AniList refresh and correct episode totals for airing shows.
--
-- Problem: The catalog has no way to track when entries were last synced
-- from AniList, and no way to count currently-aired episodes for shows that
-- are still releasing (where AniList sets episodes = NULL until the show
-- completes).  franchise_episode_total for an airing franchise therefore
-- undercounts the current season's contribution — it falls to zero for any
-- season where episodes IS NULL.
--
-- Changes:
--
--   1. Three new columns on anime:
--      synced_at           timestamptz  — when this row was last synced from AniList
--      next_airing_episode integer      — AniList nextAiringEpisode.episode
--                                         (the number of the NEXT episode to air;
--                                          currently-aired = next_airing_episode - 1)
--      next_airing_at      timestamptz  — when that episode airs (UTC)
--
--   2. Updated refresh_franchise_episode_totals()
--      For each source row contributing to a canonical unit's total:
--        COALESCE(
--          episodes,                               finished shows: AniList-supplied total
--          next_airing_episode - 1 (if RELEASING), airing shows: episodes aired so far
--          episode_count,                          legacy fallback
--          0
--        )
--      This means a currently-airing season contributes its live aired-episode
--      count rather than 0, so franchise_episode_total stays current as new
--      episodes drop.
--
-- Refresh pipeline:
--   Run scripts/refresh-anime.ts on any schedule (daily recommended).
--   The script fetches all tracked anilist_ids from the DB, queries AniList for
--   current data (episodes, status, nextAiringEpisode, relations), upserts the
--   changes, then calls SELECT public.refresh_catalog() which recomputes
--   franchise_episode_total using the updated next_airing_episode values.
-- =============================================================================


-- =============================================================================
-- Part 1 — New columns
-- =============================================================================

alter table public.anime
  add column if not exists synced_at           timestamptz;

alter table public.anime
  add column if not exists next_airing_episode integer;

alter table public.anime
  add column if not exists next_airing_at      timestamptz;

comment on column public.anime.synced_at is
  'Timestamp (UTC) when this row was last fetched and updated from AniList.
   NULL for rows created manually or seeded before migration 020.
   Used by the refresh script to identify stale entries.';

comment on column public.anime.next_airing_episode is
  'Episode number of the next scheduled broadcast (AniList nextAiringEpisode.episode).
   Currently-aired count = next_airing_episode - 1.
   NULL when the show is not currently airing (FINISHED, NOT_YET_RELEASED, etc.).
   Updated by scripts/refresh-anime.ts on every sync run.';

comment on column public.anime.next_airing_at is
  'UTC timestamp when next_airing_episode is scheduled to air.
   NULL when next_airing_episode is NULL.
   Derived from AniList nextAiringEpisode.airingAt (Unix seconds → timestamptz).';

-- Index: quickly find currently-airing entries (used by refresh script and
-- potentially by future "what's airing now" UI surfaces).
create index if not exists anime_next_airing_at_idx
  on public.anime (next_airing_at)
  where next_airing_at is not null;


-- =============================================================================
-- Part 2 — Updated refresh_franchise_episode_totals()
--
-- Replaces the version in migration 013.
--
-- Episode count per source row:
--   COALESCE(
--     s.episodes,                              -- AniList total (set when finished or
--                                              --   scheduled total is known)
--     CASE WHEN s.status = 'RELEASING'
--               AND s.next_airing_episode > 1  -- at least one episode has aired
--          THEN s.next_airing_episode - 1      -- episodes aired so far this season
--          ELSE NULL END,
--     s.episode_count,                         -- legacy column fallback
--     0                                        -- unknown — contributes nothing
--   )
--
-- This correctly handles:
--   • Finished shows              — episodes set, count exact                ✓
--   • Airing, scheduled total     — AniList sets episodes = scheduled total   ✓
--   • Airing, unknown total       — episodes NULL, use next_airing_episode-1  ✓
--   • Not-yet-released            — episodes NULL, next_airing_episode NULL → 0 ✓
--   • No episode data at all      — 0 (does not corrupt totals)               ✓
-- =============================================================================

create or replace function public.refresh_franchise_episode_totals()
returns void
language sql
security definer
set search_path = public
as $$
  -- Reset all canonical entries.
  update public.anime
  set    franchise_episode_total = null
  where  is_canonical = true;

  -- Recompute.
  -- Paths:
  --   (a) s.id = a.id                  — the canonical entry itself
  --   (b) s.franchise_root_id = a.id   — explicit sequel linked via resolve_franchise_roots()
  --   (c) title-prefix fallback        — label-detected entries still missing franchise_root_id
  --                                      (safety net; should be near-empty after migration 019)
  update public.anime as a
  set    franchise_episode_total = (
           select nullif(
                    sum(
                      coalesce(
                        s.episodes,
                        -- For airing shows: count episodes already broadcast.
                        -- next_airing_episode is the NEXT episode (not yet aired),
                        -- so aired count = next_airing_episode - 1.
                        -- Guard: only use this when at least 1 episode has aired (> 1).
                        case
                          when s.status = 'RELEASING'
                               and s.next_airing_episode > 1
                          then s.next_airing_episode - 1
                          else null
                        end,
                        s.episode_count,
                        0
                      )
                    ),
                    0
                  )
           from   public.anime as s
           where  s.format in ('TV', 'TV_SHORT')
             and  (
                    -- (a) self
                    s.id = a.id
                    or
                    -- (b) explicit franchise child
                    s.franchise_root_id = a.id
                    or
                    -- (c) title-prefix fallback (safety net)
                    (     s.is_canonical     = false
                      and s.franchise_root_id is null
                      and s.anilist_id       is not null
                      and (
                            (     a.title_english is not null
                              and char_length(a.title_english) >= 6
                              and (    lower(coalesce(s.title_english, '')) like lower(a.title_english) || ' %'
                                    or lower(coalesce(s.title_english, '')) like lower(a.title_english) || ':%'
                                    or lower(coalesce(s.title_english, '')) =    lower(a.title_english)
                                  )
                            )
                            or
                            (     a.title_romaji is not null
                              and char_length(a.title_romaji) >= 6
                              and (    lower(coalesce(s.title_romaji, '')) like lower(a.title_romaji) || ' %'
                                    or lower(coalesce(s.title_romaji, '')) like lower(a.title_romaji) || ':%'
                                    or lower(coalesce(s.title_romaji, '')) =    lower(a.title_romaji)
                                  )
                            )
                            or
                            (     a.title_romaji  is null
                              and a.title_english is null
                              and char_length(a.title) >= 6
                              and (    lower(coalesce(s.title, '')) like lower(a.title) || ' %'
                                    or lower(coalesce(s.title, '')) like lower(a.title) || ':%'
                                    or lower(coalesce(s.title, '')) =    lower(a.title)
                                  )
                            )
                          )
                    )
                  )
         )
  where  a.is_canonical = true;
$$;

comment on function public.refresh_franchise_episode_totals() is
  'Recomputes franchise_episode_total for all canonical anime entries.
   Episode contribution per source row:
     COALESCE(episodes, next_airing_episode-1 (if RELEASING), episode_count, 0).
   This keeps totals current for airing shows: as new episodes drop and
   scripts/refresh-anime.ts updates next_airing_episode, the next call to
   refresh_catalog() (or this function directly) reflects the new count.
   Idempotent — safe to call multiple times.';


-- =============================================================================
-- Part 3 — Immediate recompute
-- Recalculates totals with the new formula for all existing rows.
-- (next_airing_episode is NULL for all existing rows until refresh-anime.ts
-- is run, so results for airing shows remain as before until first sync.)
-- =============================================================================

select public.refresh_franchise_episode_totals();
