-- =============================================================================
-- Migration: franchise_root_id (Milestone 3 — relation-based franchise grouping)
--
-- Problem: subtitle-differentiated sequel series such as
--   "Dr. Stone: Stone Wars", "Mob Psycho 100 II", "Overlord III",
--   "Kaguya-sama: Love Is War - Ultra Romantic"
-- do not contain an explicit sequel-label ("Season 2", "Part 2", etc.) and do
-- not share an identical base title with their predecessor, so the existing
-- label-pattern and title-dedup logic leaves them as separate canonical entries.
--
-- Solution: two complementary fixes
--
--   Fix A — Roman-numeral suffix detection (immediate, label-pattern extension)
--     TV titles ending in a lone Roman numeral (II … XII) are sequel seasons.
--     Catches: "Mob Psycho 100 II", "Overlord III", "SAO II", "Overlord IV".
--
--   Fix B — franchise_root_id column (explicit relation-based grouping)
--     A new nullable FK: anime.franchise_root_id → anime.id
--     Set by the seed script (after re-running it) using AniList's relations
--     API to follow PREQUEL edges back to the first entry in the franchise chain.
--     When set, the canonical trigger unconditionally marks is_canonical = false.
--     franchise_episode_total is recomputed using franchise_root_id when
--     available, with a title-prefix fallback for entries not yet resolved.
-- =============================================================================

-- =============================================================================
-- Part 1 — Add franchise_root_id column
-- =============================================================================

alter table public.anime
  add column if not exists franchise_root_id uuid
    references public.anime (id) on delete set null;

comment on column public.anime.franchise_root_id is
  'UUID of the canonical Series-1 entry for this franchise sequel.
   NULL means this row IS the franchise root (or its franchise is unknown).
   Populated by the seed script via AniList PREQUEL relations.
   When set, is_canonical is automatically forced to false by the trigger.';

create index if not exists anime_franchise_root_idx
  on public.anime (franchise_root_id)
  where franchise_root_id is not null;

-- =============================================================================
-- Part 2 — Update canonical trigger with Roman-numeral detection + root-id check
-- =============================================================================

create or replace function public.anime_set_canonical()
returns trigger
language plpgsql
as $$
declare
  t_r text;
  t_e text;
  t_l text;
  hit boolean;
begin
  t_r := coalesce(NEW.title_romaji,  '');
  t_e := coalesce(NEW.title_english, '');
  t_l := coalesce(NEW.title,         '');

  -- franchise_root_id explicitly set → always non-canonical, no further checks.
  if NEW.franchise_root_id is not null then
    NEW.is_canonical := false;
    return NEW;
  end if;

  -- =========================================================================
  -- Class 1: TV / TV_SHORT — sequel-variant label detection
  -- (original patterns from migration 009 + Roman-numeral suffix from 013)
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
          -- Arc suffix at end of title
       or t_r ~* '\mArc\s*$'
       or t_e ~* '\mArc\s*$'
          -- "The Final" chapters / arcs
       or t_r ~* '\mThe\s+Final\M'
       or t_e ~* '\mThe\s+Final\M'
          -- Numbered TV specials: "Special 1", "Special 2"
       or t_r ~* '\mSpecial\s+[0-9]'
       or t_e ~* '\mSpecial\s+[0-9]'
          -- Roman-numeral suffix (II … XII) preceded by whitespace, at end of title.
          -- Catches: "Mob Psycho 100 II", "Overlord III", "SAO II", "Overlord IV".
          -- Ordered longest-first so partial matches never win over full matches.
       or t_r ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$'
       or t_e ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$'
          -- Legacy title column fallback (only when both romaji AND english are absent)
       or (NEW.title_romaji is null and NEW.title_english is null and (
                  t_l ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
               or t_l ~* '\mSeason\s+[2-9][0-9]?\M'
               or t_l ~* '\mFinal\s+Season\M'
               or t_l ~* '\mCour\s+[2-9]\M'
               or t_l ~* '\mPart\s+[2-9]\M'
               or t_l ~* '\mArc\s*$'
               or t_l ~* '\mThe\s+Final\M'
               or t_l ~* '\mSpecial\s+[0-9]'
               or t_l ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$'
             )
          )
    ) then
      NEW.is_canonical := false;
    end if;

    return NEW;
  end if;

  -- =========================================================================
  -- Class 2: MOVIE / OVA / ONA / SPECIAL — franchise-movie detection
  -- (unchanged from migration 009)
  -- =========================================================================
  if NEW.format in ('MOVIE', 'OVA', 'ONA', 'SPECIAL') then

    select exists (
      select 1
      from   public.anime as tv
      where  tv.format in ('TV', 'TV_SHORT')
        and  tv.is_canonical = true
        and  (
               (     tv.title_english is not null
                 and char_length(tv.title_english) >= 6
                 and (    lower(t_e) like lower(tv.title_english) || ' %'
                       or lower(t_e) like lower(tv.title_english) || ':%'
                       or lower(t_e) =    lower(tv.title_english)
                     )
               )
               or
               (     tv.title_romaji is not null
                 and char_length(tv.title_romaji) >= 6
                 and (    lower(t_r) like lower(tv.title_romaji) || ' %'
                       or lower(t_r) like lower(tv.title_romaji) || ':%'
                       or lower(t_r) =    lower(tv.title_romaji)
                     )
               )
               or
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

-- Re-attach trigger (drop first for idempotency; now also fires on franchise_root_id changes)
drop trigger if exists anime_canonicalize on public.anime;

create trigger anime_canonicalize
  before insert or update of title, title_romaji, title_english, format, franchise_root_id
  on public.anime
  for each row
  execute function public.anime_set_canonical();

-- =============================================================================
-- Part 3 — Backfill: apply Roman-numeral patterns to existing canonical rows
-- =============================================================================

-- Mark TV entries with Roman-numeral suffixes non-canonical.
-- (Label-pattern entries were already handled by migrations 009/011.)
update public.anime
set    is_canonical = false
where  format in ('TV', 'TV_SHORT')
  and  is_canonical = true
  and  (
          coalesce(title_romaji,  '') ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$'
       or coalesce(title_english, '') ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$'
       or (title_romaji is null and title_english is null
           and coalesce(title, '') ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$')
       );

-- Mark any TV entries that already have franchise_root_id set non-canonical.
-- (Handles cases where franchise_root_id was set before this migration ran.)
update public.anime
set    is_canonical = false
where  franchise_root_id is not null
  and  is_canonical = true;

-- =============================================================================
-- Part 4 — Recompute franchise_episode_total
-- =============================================================================

-- Reset all canonical entries so the recompute is idempotent.
update public.anime
set    franchise_episode_total = null
where  is_canonical = true;

-- Recompute.
--
-- Included in each canonical entry's total:
--   (a) The canonical entry itself.
--   (b) Non-canonical TV entries whose franchise_root_id points to this entry.
--       (These are relation-resolved sequels set by the seed script.)
--   (c) Non-canonical TV entries (anilist_id NOT NULL, no franchise_root_id)
--       whose title begins with the canonical entry's title.
--       (These are label-detected sequels where the seed script hasn't been
--       re-run yet, or entries that don't appear in AniList relations.)
--
-- Excluded: canonical sequel series (is_canonical=true → skipped by (b)/(c)),
--           manually-created aggregate rows (anilist_id IS NULL → skipped by (c)),
--           MOVIE/OVA/ONA/SPECIAL entries (format filter).

update public.anime as a
set    franchise_episode_total = (
         select nullif(
                  sum(coalesce(s.episodes, s.episode_count, 0)),
                  0
                )
         from   public.anime as s
         where  s.format in ('TV', 'TV_SHORT')
           and  (
                  -- (a) self
                  s.id = a.id
                  or
                  -- (b) explicit relation-based sequels
                  s.franchise_root_id = a.id
                  or
                  -- (c) label-detected sequels (title-prefix fallback)
                  (     s.is_canonical    = false
                    and s.franchise_root_id is null
                    and s.anilist_id      is not null
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

-- =============================================================================
-- Part 5 — Stored function: refresh_franchise_episode_totals()
-- Called by the seed script after Phase 2 sets franchise_root_id values,
-- so episode totals reflect the newly resolved franchise chains.
-- Also callable manually: SELECT public.refresh_franchise_episode_totals();
-- =============================================================================

create or replace function public.refresh_franchise_episode_totals()
returns void
language sql
security definer
set search_path = public
as $$
  -- Reset
  update public.anime
  set    franchise_episode_total = null
  where  is_canonical = true;

  -- Recompute (same logic as Part 4 above, kept in sync)
  update public.anime as a
  set    franchise_episode_total = (
           select nullif(
                    sum(coalesce(s.episodes, s.episode_count, 0)),
                    0
                  )
           from   public.anime as s
           where  s.format in ('TV', 'TV_SHORT')
             and  (
                    s.id = a.id
                    or
                    s.franchise_root_id = a.id
                    or
                    (     s.is_canonical    = false
                      and s.franchise_root_id is null
                      and s.anilist_id      is not null
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
