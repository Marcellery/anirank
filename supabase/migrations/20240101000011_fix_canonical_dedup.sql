-- =============================================================================
-- Migration: fix_canonical_dedup (Milestone 3 — correct dedup + episode total)
--
-- Fixes two bugs introduced by migrations 010:
--
--   Bug A  Duplicate canonical rows per franchise still visible.
--          Root cause: migration 010's dedup used separate column conditions
--          (title_english IS NOT NULL AND ... = ...) that silently skip rows
--          where the manually-created franchise-summary entry stored its name
--          only in the legacy `title` column (title_english and title_romaji
--          both null).  Neither OR branch matched → both rows stayed canonical.
--
--   Bug B  franchise_episode_total over-merges franchise families.
--          Root cause: the backfill summed ALL rows matching the title prefix
--          with no is_canonical filter.  "Naruto: Shippuden" (canonical) and
--          "Dragon Ball Z" (canonical, starts with "Dragon Ball ") were both
--          included, producing 720+ and 1440+ style totals.
--
-- Fixes:
--   Step 1  Re-run dedup using coalesce(title_english, title_romaji, title)
--           so manually-created rows (title only) are correctly matched.
--           Tiebreak: keep earliest season_year, then AniList row over manual,
--           then lower anilist_id.
--
--   Step 2  Re-backfill franchise_episode_total with the corrected rule:
--           sum only (a) the canonical entry itself and (b) non-canonical
--           rows (is_canonical = false) that have a real anilist_id and whose
--           title starts with the canonical title.
--           Canonical sequel series (Shippuden, DBZ) have is_canonical = true
--           → excluded.  Manually-aggregated summary rows have anilist_id NULL
--           → excluded (prevents double-counting after they become non-canonical).
--
--   Step 3  Fix any canonical rows still missing a cover image by copying
--           from the lowest-anilist_id non-canonical sibling that has one.
-- =============================================================================

-- =============================================================================
-- Step 1 — re-deduplicate canonical TV entries (corrected title matching)
-- =============================================================================

-- Uses coalesce(title_english, title_romaji, title) so that a row storing its
-- name only in the legacy `title` column is still compared correctly.
--
-- Safe to re-run: WHERE is_canonical = true means already-deduped rows are
-- skipped.  Only the "loser" of each pair is updated.

update public.anime as a
set    is_canonical = false
where  a.format in ('TV', 'TV_SHORT')
  and  a.is_canonical = true
  and  exists (
         select 1
         from   public.anime as b
         where  b.format in ('TV', 'TV_SHORT')
           and  b.is_canonical = true
           and  b.id  != a.id
           -- Same display title (any column)
           and  lower(coalesce(a.title_english, a.title_romaji, a.title))
                = lower(coalesce(b.title_english, b.title_romaji, b.title))
           -- b is preferred over a:
           --   1. b has an earlier season_year  (NULL → 9999, pushed to end)
           --   2. tie: b has a real anilist_id and a was manually created
           --   3. tie: both AniList rows, keep the lower (older) anilist_id
           and  (
                  coalesce(b.season_year, 9999) < coalesce(a.season_year, 9999)
                  or (     coalesce(b.season_year, 9999) = coalesce(a.season_year, 9999)
                       and b.anilist_id is not null
                       and a.anilist_id is null
                     )
                  or (     coalesce(b.season_year, 9999) = coalesce(a.season_year, 9999)
                       and b.anilist_id is not null
                       and a.anilist_id is not null
                       and b.anilist_id < a.anilist_id
                     )
                )
       );

-- =============================================================================
-- Step 2 — re-backfill franchise_episode_total (corrected sum rule)
-- =============================================================================

-- Reset all canonical rows so the backfill is idempotent.
update public.anime
set    franchise_episode_total = null
where  is_canonical = true;

-- Now re-compute using the corrected rule.
--
-- Included in the sum:
--   - The canonical entry itself              (s.id = a.id)
--   - Non-canonical AniList sequel entries    (is_canonical=false, anilist_id NOT NULL)
--     whose title starts with the canonical entry's title (space or colon separator)
--
-- Excluded from the sum:
--   - Canonical sequel series ("Naruto: Shippuden", "Dragon Ball Z")
--     → they are is_canonical=true so the filter skips them
--   - Manually-created franchise-summary rows (anilist_id IS NULL, now non-canonical)
--     → the anilist_id IS NOT NULL guard prevents double-counting their already-
--       aggregated episode totals

update public.anime as a
set    franchise_episode_total = (
         select nullif(
                  sum(coalesce(s.episodes, s.episode_count, 0)),
                  0
                )
         from   public.anime as s
         where  s.format in ('TV', 'TV_SHORT')   -- TV episodes only; exclude MOVIE/OVA/ONA/SPECIAL
           and  (
                  -- include self
                  s.id = a.id
                  or
                  -- include non-canonical AniList sequel variants only
                  (s.is_canonical = false and s.anilist_id is not null)
                )
           and  (
                  -- English prefix: s title starts with a's english title
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
                  -- Legacy title fallback (rows without romaji/english on either side)
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
where  a.is_canonical = true;

-- =============================================================================
-- Step 3 — fix missing posters on canonical entries
-- =============================================================================

-- After correct deduplication the surviving canonical row is always the real
-- AniList Season 1 entry and already has cover_image_large.  This step is a
-- safety net for the rare edge case where it does not.
--
-- For each canonical entry missing a cover, copy from the non-canonical sibling
-- with the lowest anilist_id (= the most recognisable continuation artwork).

update public.anime as a
set    cover_image_large  = sub.cover_image_large,
       cover_image_medium = coalesce(sub.cover_image_medium, sub.cover_image_large)
from   (
         select distinct on (a2.id)
                a2.id               as canonical_id,
                s.cover_image_large,
                s.cover_image_medium
         from   public.anime a2
         join   public.anime s
                  on  s.is_canonical    = false
                  and s.anilist_id      is not null
                  and s.cover_image_large is not null
                  and (
                        (     a2.title_english is not null
                          and (    lower(coalesce(s.title_english, ''))
                                   like lower(a2.title_english) || ' %'
                                or lower(coalesce(s.title_english, ''))
                                   like lower(a2.title_english) || ':%'
                              )
                        )
                        or
                        (     a2.title_romaji is not null
                          and (    lower(coalesce(s.title_romaji, ''))
                                   like lower(a2.title_romaji) || ' %'
                                or lower(coalesce(s.title_romaji, ''))
                                   like lower(a2.title_romaji) || ':%'
                              )
                        )
                      )
         where  a2.is_canonical       = true
           and  a2.cover_image_large  is null
         order  by a2.id, s.anilist_id asc
       ) sub
where  a.id = sub.canonical_id;
