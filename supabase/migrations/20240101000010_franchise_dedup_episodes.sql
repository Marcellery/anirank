-- =============================================================================
-- Migration: franchise_dedup_episodes (Milestone 3 — picker deduplication)
--
-- Problem: multiple rows with is_canonical = true exist for the same franchise.
-- This happens because "franchise-level" summary rows (manually created or
-- imported via earlier tooling) have the same base title as the AniList Season 1
-- row but carry no sequel-label, so migration 009's pattern matching leaves both
-- as canonical.  The picker then shows both (e.g. 87-ep + 25-ep for AoT).
--
-- Fix:
--   Step 1  Deduplicate canonical TV entries that share the same title.
--           Keep the entry with the earliest season_year; break ties by
--           preferring real AniList rows (anilist_id IS NOT NULL) over
--           manually-created ones, then by lower anilist_id.
--
--   Step 2  Add franchise_episode_total — the sum of every entry's episode
--           count whose title is prefixed by the canonical entry's title.
--           This gives the correct total (e.g. all AoT seasons = 87) on the
--           single surviving canonical row.
--
-- Note: this migration never DELETEs rows; it only sets is_canonical = false
-- and writes to the new column.  To hard-delete non-canonical rows later:
--   DELETE FROM public.anime WHERE is_canonical = false;
-- =============================================================================

-- =============================================================================
-- Step 1 — deduplicate same-title canonical TV entries
-- =============================================================================

-- When two canonical TV/TV_SHORT rows share the same romaji OR english title,
-- the "later" one is marked non-canonical.  "Later" is defined as:
--   a) higher season_year  (NULL counts as 9999 — pushed to end)
--   b) tie: NULL anilist_id loses to a real anilist_id
--   c) tie: higher anilist_id loses

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
           -- b and a share the same franchise title
           and  (
                  (     a.title_romaji is not null
                    and b.title_romaji is not null
                    and lower(a.title_romaji) = lower(b.title_romaji)
                  )
                  or
                  (     a.title_english is not null
                    and b.title_english is not null
                    and lower(a.title_english) = lower(b.title_english)
                  )
                )
           -- b is the preferred (earlier/more authoritative) entry
           and  (
                  -- b has an earlier season_year
                  coalesce(b.season_year, 9999) < coalesce(a.season_year, 9999)
                  or
                  -- same year: prefer the AniList row over a manually-created one
                  (     coalesce(b.season_year, 9999) = coalesce(a.season_year, 9999)
                    and b.anilist_id is not null
                    and a.anilist_id is null
                  )
                  or
                  -- same year, both AniList: keep the lower (older) anilist_id
                  (     coalesce(b.season_year, 9999) = coalesce(a.season_year, 9999)
                    and b.anilist_id is not null
                    and a.anilist_id is not null
                    and b.anilist_id < a.anilist_id
                  )
                )
       );

-- =============================================================================
-- Step 2 — add and backfill franchise_episode_total
-- =============================================================================

alter table public.anime
  add column if not exists franchise_episode_total integer;

comment on column public.anime.franchise_episode_total is
  'Total episode count across the entire franchise (canonical + sequel variants).
   Populated by the backfill in migration 010; refresh by re-running that step.';

-- Backfill: for each canonical entry, sum the episodes of every row whose
-- title begins with the canonical entry''s title (space or colon separator),
-- including the canonical entry itself.
--
-- Example: canonical "Attack on Titan" collects S1 (25) + S2 (12) + S3 (22)
--          + Final Season (28) + specials (2) = 89 episodes stored here.
--
-- NULLIF(..., 0) returns NULL when all related rows have null episode counts,
-- letting the app fall back to the per-row episodes / episode_count columns.

update public.anime as a
set    franchise_episode_total = (
         select nullif(
                  sum(coalesce(s.episodes, s.episode_count, 0)),
                  0
                )
         from   public.anime as s
         where  (
                  -- English prefix: s.title starts with a.title (+ space or colon)
                  (     a.title_english is not null
                    and char_length(a.title_english) >= 6
                    and (    lower(coalesce(s.title_english, '')) like lower(a.title_english) || ' %'
                          or lower(coalesce(s.title_english, '')) like lower(a.title_english) || ':%'
                          or lower(coalesce(s.title_english, '')) =    lower(a.title_english)
                        )
                  )
                  or
                  -- Romaji prefix
                  (     a.title_romaji is not null
                    and char_length(a.title_romaji) >= 6
                    and (    lower(coalesce(s.title_romaji, '')) like lower(a.title_romaji) || ' %'
                          or lower(coalesce(s.title_romaji, '')) like lower(a.title_romaji) || ':%'
                          or lower(coalesce(s.title_romaji, '')) =    lower(a.title_romaji)
                        )
                  )
                  or
                  -- Legacy title fallback
                  (     a.title_romaji is null
                    and a.title_english is null
                    and char_length(a.title) >= 6
                    and (    lower(coalesce(s.title, '')) like lower(a.title) || ' %'
                          or lower(coalesce(s.title, '')) like lower(a.title) || ':%'
                          or lower(coalesce(s.title, '')) =    lower(a.title)
                        )
                  )
                )
       )
where  a.is_canonical = true;
