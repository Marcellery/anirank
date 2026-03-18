-- =============================================================================
-- Migration: anime_canonical (Milestone 3.6)
-- Adds is_canonical flag so the catalogue picker shows series-level entries
-- only, hiding sequel-season rows (Season 2, Final Season, Part 2, etc.).
--
-- Rule: a TV/TV_SHORT entry is non-canonical when its title contains an
-- explicit sequel-season marker.  Distinct-title continuations (Naruto →
-- Naruto Shippuden, Dragon Ball Z, etc.) are unaffected.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New column
-- ---------------------------------------------------------------------------

alter table public.anime
  add column if not exists is_canonical boolean not null default true;

comment on column public.anime.is_canonical is
  'false for sequel-season entries (Season 2, Final Season, Part 2 …).
   Catalogue queries filter to is_canonical = true by default.';

-- ---------------------------------------------------------------------------
-- 2. Index — partial index on non-canonical rows is tiny; main benefit is
--    letting the planner skip non-canonical rows cheaply on the true side.
-- ---------------------------------------------------------------------------

create index if not exists anime_is_canonical_idx
  on public.anime (is_canonical)
  where is_canonical = false;

-- ---------------------------------------------------------------------------
-- 3. Backfill existing rows
--
-- Patterns (case-insensitive):
--   a) "2nd Season" … "10th Season"
--   b) "Season 2" … "Season 99"
--   c) "Final Season"
--   d) "Cour 2" … "Cour 9"   (split-cour continuations)
--   e) "Part 2" … "Part 9"   (mid-season splits)
--
-- Only applied to TV / TV_SHORT; movies, OVA, specials are untouched.
-- ---------------------------------------------------------------------------

update public.anime
set    is_canonical = false
where  format in ('TV', 'TV_SHORT')
  and  is_canonical = true   -- idempotent
  and  (
         -- title_romaji checks
         title_romaji  ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
      or title_romaji  ~* '\mSeason\s+[2-9][0-9]?\M'
      or title_romaji  ~* '\mFinal\s+Season\M'
      or title_romaji  ~* '\mCour\s+[2-9]\M'
      or title_romaji  ~* '\mPart\s+[2-9]\M'
         -- title_english checks
      or title_english ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
      or title_english ~* '\mSeason\s+[2-9][0-9]?\M'
      or title_english ~* '\mFinal\s+Season\M'
      or title_english ~* '\mCour\s+[2-9]\M'
      or title_english ~* '\mPart\s+[2-9]\M'
         -- legacy title column fallback (for rows without romaji/english)
      or (title_romaji is null and title_english is null
          and (   title ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
               or title ~* '\mSeason\s+[2-9][0-9]?\M'
               or title ~* '\mFinal\s+Season\M'
               or title ~* '\mCour\s+[2-9]\M'
               or title ~* '\mPart\s+[2-9]\M'
              )
         )
       );
