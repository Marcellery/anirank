-- =============================================================================
-- Migration: franchise_canonical (Milestone 3 — franchise-level ranking)
--
-- Product rule: one canonical entry per franchise.
-- Non-canonical entries are hidden from onboarding, search, and battles.
--
-- Two classes of non-canonical entries:
--
--   Class 1 — TV/TV_SHORT sequel variants
--     Any TV entry whose title contains a sequel-label word:
--     Season N, Final Season, Cour N, Part N, "[Word] Arc" (end of title),
--     The Final, Special N (numbered TV specials).
--     Distinct-title continuations (Naruto Shippuden, Dragon Ball Z) are
--     intentionally unaffected.
--
--   Class 2 — Franchise movies / OVAs / specials
--     Any MOVIE/OVA/ONA/SPECIAL whose title begins with the same string as
--     a canonical TV/TV_SHORT title (≥6 chars, space or colon separator).
--     Catches: "Jujutsu Kaisen 0", "Demon Slayer: … Mugen Train",
--              "One Piece Film: Red", "My Hero Academia: Heroes Rising".
--     Misses on purpose: "Spirited Away", "Your Name." — no matching prefix.
--
-- Structure:
--   Part A — trigger function (runs at INSERT / UPDATE time, import-safe)
--   Part B — backfill (re-processes all existing rows idempotently)
-- =============================================================================

-- =============================================================================
-- Part A — trigger function
-- =============================================================================

create or replace function public.anime_set_canonical()
returns trigger
language plpgsql
as $$
declare
  t_r text;   -- title_romaji  (coalesced)
  t_e text;   -- title_english (coalesced)
  t_l text;   -- legacy title  (coalesced)
  hit boolean;
begin
  t_r := coalesce(NEW.title_romaji,  '');
  t_e := coalesce(NEW.title_english, '');
  t_l := coalesce(NEW.title,         '');

  -- =========================================================================
  -- Class 1: TV / TV_SHORT — sequel-variant label detection
  -- =========================================================================
  if NEW.format in ('TV', 'TV_SHORT') then

    if (
          -- Ordinal seasons: "2nd Season" … "10th Season"
          t_r ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
       or t_e ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
          -- Numbered seasons: "Season 2" … "Season 99"
       or t_r ~* '\mSeason\s+[2-9][0-9]?\M'
       or t_e ~* '\mSeason\s+[2-9][0-9]?\M'
          -- Final Season
       or t_r ~* '\mFinal\s+Season\M'
       or t_e ~* '\mFinal\s+Season\M'
          -- Split-cour: "Cour 2" … "Cour 9"
       or t_r ~* '\mCour\s+[2-9]\M'
       or t_e ~* '\mCour\s+[2-9]\M'
          -- Mid-season parts: "Part 2" … "Part 9"
       or t_r ~* '\mPart\s+[2-9]\M'
       or t_e ~* '\mPart\s+[2-9]\M'
          -- Arc suffix at end of title: "Swordsmith Village Arc", "Mugen Train Arc"
          -- Anchored to end-of-string so "Arc-V" and "Arcane" are NOT matched.
       or t_r ~* '\mArc\s*$'
       or t_e ~* '\mArc\s*$'
          -- "The Final" chapters / arcs (e.g. AoT "THE FINAL CHAPTERS")
       or t_r ~* '\mThe\s+Final\M'
       or t_e ~* '\mThe\s+Final\M'
          -- Numbered TV specials within a series: "Special 1", "Special 2"
       or t_r ~* '\mSpecial\s+[0-9]'
       or t_e ~* '\mSpecial\s+[0-9]'
          -- Legacy title column fallback (only when romaji AND english are absent)
       or (NEW.title_romaji is null and NEW.title_english is null and (
                  t_l ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
               or t_l ~* '\mSeason\s+[2-9][0-9]?\M'
               or t_l ~* '\mFinal\s+Season\M'
               or t_l ~* '\mCour\s+[2-9]\M'
               or t_l ~* '\mPart\s+[2-9]\M'
               or t_l ~* '\mArc\s*$'
               or t_l ~* '\mThe\s+Final\M'
               or t_l ~* '\mSpecial\s+[0-9]'
             )
          )
    ) then
      NEW.is_canonical := false;
    end if;

    return NEW;
  end if;

  -- =========================================================================
  -- Class 2: MOVIE / OVA / ONA / SPECIAL — franchise-movie detection
  --
  -- Mark non-canonical when this entry's title begins with a canonical
  -- TV/TV_SHORT title (minimum 6 chars, separated by space or colon).
  --
  -- Space-separated:  "Jujutsu Kaisen 0"         prefix "Jujutsu Kaisen"
  -- Colon-separated:  "Demon Slayer: … Mugen Train" prefix "Demon Slayer: Kimetsu no Yaiba"
  -- Exact match:      edge case where movie title == series title
  -- =========================================================================
  if NEW.format in ('MOVIE', 'OVA', 'ONA', 'SPECIAL') then

    select exists (
      select 1
      from   public.anime as tv
      where  tv.format in ('TV', 'TV_SHORT')
        and  tv.is_canonical = true
        and  (
               -- English title prefix check
               (     tv.title_english is not null
                 and char_length(tv.title_english) >= 6
                 and (    lower(t_e) like lower(tv.title_english) || ' %'
                       or lower(t_e) like lower(tv.title_english) || ':%'
                       or lower(t_e) =    lower(tv.title_english)
                     )
               )
               or
               -- Romaji title prefix check
               (     tv.title_romaji is not null
                 and char_length(tv.title_romaji) >= 6
                 and (    lower(t_r) like lower(tv.title_romaji) || ' %'
                       or lower(t_r) like lower(tv.title_romaji) || ':%'
                       or lower(t_r) =    lower(tv.title_romaji)
                     )
               )
               or
               -- Legacy title prefix fallback (rows without romaji/english)
               (     tv.title_romaji is null
                 and tv.title_english is null
                 and char_length(tv.title) >= 6
                 and (    lower(t_l) like lower(tv.title) || ' %'
                       or lower(t_l) like lower(tv.title) || ':%'
                       or lower(t_l) =    lower(tv.title)
                     )
               )
             )
    ) into hit;

    if hit then
      NEW.is_canonical := false;
    end if;

  end if;

  return NEW;
end;
$$;

-- Attach trigger (drop first so re-running the migration is idempotent)
drop trigger if exists anime_canonicalize on public.anime;

create trigger anime_canonicalize
  before insert or update of title, title_romaji, title_english, format
  on public.anime
  for each row
  execute function public.anime_set_canonical();

-- =============================================================================
-- Part B — backfill (idempotent; safe to re-run)
-- =============================================================================

-- Step 1: Reset ALL TV/TV_SHORT rows to canonical = true.
-- This makes the full expanded ruleset the single source of truth and
-- corrects any rows that prior migrations over-aggressively flagged.
update public.anime
set    is_canonical = true
where  format in ('TV', 'TV_SHORT');

-- Step 2: Re-apply Class 1 (TV sequel patterns) to all TV rows.
update public.anime
set    is_canonical = false
where  format in ('TV', 'TV_SHORT')
  and  (
          coalesce(title_romaji,'')  ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
       or coalesce(title_english,'') ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
       or coalesce(title_romaji,'')  ~* '\mSeason\s+[2-9][0-9]?\M'
       or coalesce(title_english,'') ~* '\mSeason\s+[2-9][0-9]?\M'
       or coalesce(title_romaji,'')  ~* '\mFinal\s+Season\M'
       or coalesce(title_english,'') ~* '\mFinal\s+Season\M'
       or coalesce(title_romaji,'')  ~* '\mCour\s+[2-9]\M'
       or coalesce(title_english,'') ~* '\mCour\s+[2-9]\M'
       or coalesce(title_romaji,'')  ~* '\mPart\s+[2-9]\M'
       or coalesce(title_english,'') ~* '\mPart\s+[2-9]\M'
       or coalesce(title_romaji,'')  ~* '\mArc\s*$'
       or coalesce(title_english,'') ~* '\mArc\s*$'
       or coalesce(title_romaji,'')  ~* '\mThe\s+Final\M'
       or coalesce(title_english,'') ~* '\mThe\s+Final\M'
       or coalesce(title_romaji,'')  ~* '\mSpecial\s+[0-9]'
       or coalesce(title_english,'') ~* '\mSpecial\s+[0-9]'
       or (title_romaji is null and title_english is null and (
                  coalesce(title,'') ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
               or coalesce(title,'') ~* '\mSeason\s+[2-9][0-9]?\M'
               or coalesce(title,'') ~* '\mFinal\s+Season\M'
               or coalesce(title,'') ~* '\mCour\s+[2-9]\M'
               or coalesce(title,'') ~* '\mPart\s+[2-9]\M'
               or coalesce(title,'') ~* '\mArc\s*$'
               or coalesce(title,'') ~* '\mThe\s+Final\M'
               or coalesce(title,'') ~* '\mSpecial\s+[0-9]'
             )
          )
       );

-- Step 3: Apply Class 2 (franchise-movie detection) to MOVIE/OVA/ONA/SPECIAL rows.
-- All such rows start at is_canonical = true (migrations 007/008 never touched them).
-- This marks franchise tie-ins non-canonical while leaving standalone films alone.
update public.anime as m
set    is_canonical = false
where  m.format in ('MOVIE', 'OVA', 'ONA', 'SPECIAL')
  and  m.is_canonical = true
  and  exists (
         select 1
         from   public.anime as tv
         where  tv.format in ('TV', 'TV_SHORT')
           and  tv.is_canonical = true
           and  tv.id != m.id
           and  (
                  (     tv.title_english is not null
                    and char_length(tv.title_english) >= 6
                    and (    lower(coalesce(m.title_english,'')) like lower(tv.title_english) || ' %'
                          or lower(coalesce(m.title_english,'')) like lower(tv.title_english) || ':%'
                          or lower(coalesce(m.title_english,'')) =    lower(tv.title_english)
                        )
                  )
                  or
                  (     tv.title_romaji is not null
                    and char_length(tv.title_romaji) >= 6
                    and (    lower(coalesce(m.title_romaji,'')) like lower(tv.title_romaji) || ' %'
                          or lower(coalesce(m.title_romaji,'')) like lower(tv.title_romaji) || ':%'
                          or lower(coalesce(m.title_romaji,'')) =    lower(tv.title_romaji)
                        )
                  )
                  or
                  (     tv.title_romaji is null
                    and tv.title_english is null
                    and char_length(tv.title) >= 6
                    and (    lower(coalesce(m.title,'')) like lower(tv.title) || ' %'
                          or lower(coalesce(m.title,'')) like lower(tv.title) || ':%'
                          or lower(coalesce(m.title,'')) =    lower(tv.title)
                        )
                  )
                )
       );
