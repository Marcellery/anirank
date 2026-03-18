-- =============================================================================
-- Migration: fix_classification (021)
--
-- Fixes two structural bugs in the catalog classification pipeline:
--
-- Bug A — reclassify_catalog() Step 6 (series_root promotion) was blind to
--   label-detected franchise_child entries that still have franchise_root_id = NULL.
--   This happens when prequel_anilist_id was never populated: the entry is correctly
--   marked franchise_child by label patterns (Step 2), but Step 6 only searches for
--   children via c.franchise_root_id = r.id.  With franchise_root_id NULL, the
--   EXISTS finds nothing — the parent stays standalone_work instead of series_root,
--   and franchise-attached movies (JJK 0) then fail to match a selectable TV parent
--   in Step 5, remaining standalone_work incorrectly.
--
--   Fix: Step 6 now uses a two-arm EXISTS:
--     Arm (a) — franchise_root_id FK match (explicit, preferred)
--     Arm (b) — title-prefix match for franchise_child entries where franchise_root_id
--               is NULL (label-detected but not yet chain-resolved)
--   Either arm promotes the parent to series_root.
--
-- Bug B — resolve_franchise_roots() Steps 4 and 6 used is_canonical to find root
--   candidates and non-canonical targets.  is_canonical reflects the last trigger
--   evaluation (per-row at INSERT/UPDATE time), not the current pipeline state.
--   When the pipeline starts from a broken prior state, stale is_canonical values
--   cause wrong franchise_root_id assignments.
--
--   Fix: replace all r.is_canonical = true / a.is_canonical = false references
--   with catalog_type equivalents:
--     r.is_canonical = true  →  r.catalog_type != 'franchise_child'
--     a.is_canonical = false →  a.catalog_type  = 'franchise_child'
--
-- Additional changes:
--   - refresh_catalog() pipeline now starts with reclassify_catalog() BEFORE
--     resolve_franchise_roots(), so catalog_type is always clean when used for
--     root detection.  Final order: reclass → resolve → reclass → resolve →
--     reclass → totals → search.
--   - refresh_franchise_episode_totals() uses catalog_type instead of is_canonical
--     and explicitly NULLs out franchise_episode_total for franchise_child rows so
--     totals never appear on hidden entries.
-- =============================================================================


-- =============================================================================
-- Part 1 — Updated resolve_franchise_roots()
--
-- All changes vs migration 018:
--   Step 4: r.is_canonical = true   →  r.catalog_type != 'franchise_child'
--           a.is_canonical = true   →  a.catalog_type != 'franchise_child'
--   Step 6: r.is_canonical = true   →  r.catalog_type != 'franchise_child'
--           a.is_canonical = false  →  a.catalog_type  = 'franchise_child'
-- =============================================================================

create or replace function public.resolve_franchise_roots()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

  -- Step 1: Reset franchise_root_id for all rows that have one.
  -- Trigger anime_set_canonical() fires per-row: re-evaluates catalog_type and
  -- is_canonical via label patterns for each reset row.
  update public.anime
  set    franchise_root_id = null
  where  franchise_root_id is not null;

  -- Step 2: One-hop resolution via explicit prequel_anilist_id data.
  -- Trigger fires per-row: franchise_root_id IS NOT NULL → franchise_child.
  update public.anime as a
  set    franchise_root_id = p.id
  from   public.anime as p
  where  a.prequel_anilist_id = p.anilist_id
    and  p.anilist_id is not null;

  -- Step 3: Propagate chains to the ultimate root.
  for _depth in 1..10 loop
    update public.anime as a
    set    franchise_root_id = p.franchise_root_id
    from   public.anime as p
    where  a.franchise_root_id  = p.id
      and  p.franchise_root_id is not null;
    exit when not found;
  end loop;

  -- -------------------------------------------------------------------------
  -- Step 4: Subtitle-colon fallback for entries still without root.
  --
  -- Targets entries that are catalog_type != franchise_child (i.e. selectable)
  -- whose title begins with another selectable entry's title followed by a colon:
  --   "Dr. Stone: New World"  →  root = "Dr. Stone"
  --
  -- CHANGED from migration 018: r.is_canonical / a.is_canonical replaced with
  -- catalog_type checks so stale is_canonical values cannot affect root detection.
  --
  -- Strict season_year: root must be OLDER (< not <=) to avoid same-year
  -- split-cour shows being collapsed here (handled in Step 6 instead).
  -- -------------------------------------------------------------------------
  with best_root as (
    select distinct on (a.id)
           a.id as sequel_id,
           r.id as root_id
    from   public.anime as a
    join   public.anime as r
             on  r.format         in ('TV', 'TV_SHORT')
             and r.catalog_type   != 'franchise_child'    -- selectable root candidate
             and r.id             != a.id
             and coalesce(r.season_year, 9999) < coalesce(a.season_year, 9999)
             and (
                   (     r.title_english is not null
                     and char_length(r.title_english) >= 6
                     and lower(coalesce(a.title_english, ''))
                             like lower(r.title_english) || ':%'
                   )
                   or
                   (     r.title_romaji is not null
                     and char_length(r.title_romaji) >= 6
                     and lower(coalesce(a.title_romaji, ''))
                             like lower(r.title_romaji) || ':%'
                   )
                 )
    where  a.format         in ('TV', 'TV_SHORT')
      and  a.catalog_type   != 'franchise_child'           -- CHANGED: was is_canonical = true
      and  a.franchise_root_id is null
    order  by a.id,
              coalesce(r.season_year, 0) desc,
              r.anilist_id asc
  )
  update public.anime as a
  set    franchise_root_id = br.root_id
  from   best_root as br
  where  a.id = br.sequel_id;

  -- Step 5: Propagate after Step 4.
  for _depth in 1..10 loop
    update public.anime as a
    set    franchise_root_id = p.franchise_root_id
    from   public.anime as p
    where  a.franchise_root_id  = p.id
      and  p.franchise_root_id is not null;
    exit when not found;
  end loop;

  -- -------------------------------------------------------------------------
  -- Step 6: Title-prefix fallback for franchise_child entries still without root.
  --
  -- These are label-detected entries ("Season 2", "Arc", Roman numerals, etc.)
  -- where prequel_anilist_id was NULL (Steps 2–3 skipped them) and the title
  -- uses a space separator rather than a colon (Step 4 skipped them).
  -- Examples: "Attack on Titan Season 2", "Overlord II", "JJK 2nd Season".
  --
  -- CHANGED from migration 018: r.is_canonical / a.is_canonical replaced with
  -- catalog_type checks.  Using catalog_type prevents stale is_canonical values
  -- from causing wrong root assignments when the DB is in a partially-broken state.
  --
  -- Uses <= for season_year to handle same-year split-cour shows.
  -- -------------------------------------------------------------------------
  with best_root as (
    select distinct on (a.id)
           a.id as sequel_id,
           r.id as root_id
    from   public.anime as a
    join   public.anime as r
             on  r.format         in ('TV', 'TV_SHORT')
             and r.catalog_type   != 'franchise_child'    -- CHANGED: was is_canonical = true
             and r.id             != a.id
             and coalesce(r.season_year, 9999) <= coalesce(a.season_year, 9999)
             and (
                   (     r.title_english is not null
                     and char_length(r.title_english) >= 6
                     and (    lower(coalesce(a.title_english, ''))
                                  like lower(r.title_english) || ' %'
                           or lower(coalesce(a.title_english, ''))
                                  like lower(r.title_english) || ':%'
                           or lower(coalesce(a.title_english, ''))
                                   =   lower(r.title_english)
                         )
                   )
                   or
                   (     r.title_romaji is not null
                     and char_length(r.title_romaji) >= 6
                     and (    lower(coalesce(a.title_romaji, ''))
                                  like lower(r.title_romaji) || ' %'
                           or lower(coalesce(a.title_romaji, ''))
                                  like lower(r.title_romaji) || ':%'
                           or lower(coalesce(a.title_romaji, ''))
                                   =   lower(r.title_romaji)
                         )
                   )
                   or
                   (     r.title_romaji  is null
                     and r.title_english is null
                     and char_length(r.title) >= 6
                     and (    lower(coalesce(a.title, ''))
                                  like lower(r.title) || ' %'
                           or lower(coalesce(a.title, ''))
                                  like lower(r.title) || ':%'
                           or lower(coalesce(a.title, ''))
                                   =   lower(r.title)
                         )
                   )
                 )
    where  a.format         in ('TV', 'TV_SHORT')
      and  a.catalog_type    = 'franchise_child'           -- CHANGED: was is_canonical = false
      and  a.franchise_root_id is null
      and  a.anilist_id      is not null
    order  by a.id,
              coalesce(r.season_year, 0) desc,
              r.anilist_id asc
  )
  update public.anime as a
  set    franchise_root_id = br.root_id
  from   best_root as br
  where  a.id = br.sequel_id;

  -- Step 7: Final propagation pass.
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
  'Resolves franchise_root_id for ALL anime rows.
   Steps 1–3: explicit prequel_anilist_id chains.
   Steps 4–5: subtitle-colon fallback for selectable entries without prequel data.
   Steps 6–7: title-prefix fallback for franchise_child entries without a root.
   Uses catalog_type (not is_canonical) for root detection — immune to stale
   is_canonical values from broken prior pipeline runs.
   Idempotent — safe to call multiple times.';


-- =============================================================================
-- Part 2 — Updated reclassify_catalog()
--
-- Key change vs migration 019:
--   Step 6 (series_root promotion) now uses a two-arm EXISTS:
--     Arm (a) — franchise_root_id FK match (explicit)
--     Arm (b) — title-prefix match for franchise_child entries where
--               franchise_root_id IS NULL (label-detected, not yet chain-resolved)
--   This fixes Bug A: Season 1 is promoted to series_root even when Season 2
--   was demoted by label detection but still has franchise_root_id = NULL.
-- =============================================================================

create or replace function public.reclassify_catalog()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

  -- -----------------------------------------------------------------------
  -- Step 1: Reset all rows to standalone_work.
  -- Starting assumption: every entry is self-contained and selectable.
  -- Steps 2–5 demote entries to franchise_child; Step 6 promotes roots.
  -- Note: this UPDATE touches catalog_type only — the trigger column list
  -- (title, title_romaji, title_english, format, franchise_root_id) does NOT
  -- include catalog_type, so anime_set_canonical() does NOT fire here.
  -- -----------------------------------------------------------------------
  update public.anime
  set    catalog_type = 'standalone_work'
  where  catalog_type != 'standalone_work';

  -- -----------------------------------------------------------------------
  -- Step 2: TV / TV_SHORT sequel-label patterns → franchise_child.
  -- Mirrors the trigger's Class 1 detection as a batch UPDATE.
  -- -----------------------------------------------------------------------
  update public.anime
  set    catalog_type = 'franchise_child'
  where  format in ('TV', 'TV_SHORT')
    and  catalog_type = 'standalone_work'
    and  (
            coalesce(title_romaji,  '') ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
         or coalesce(title_english, '') ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
         or coalesce(title_romaji,  '') ~* '\mSeason\s+[2-9][0-9]?\M'
         or coalesce(title_english, '') ~* '\mSeason\s+[2-9][0-9]?\M'
         or coalesce(title_romaji,  '') ~* '\mFinal\s+Season\M'
         or coalesce(title_english, '') ~* '\mFinal\s+Season\M'
         or coalesce(title_romaji,  '') ~* '\mCour\s+[2-9]\M'
         or coalesce(title_english, '') ~* '\mCour\s+[2-9]\M'
         or coalesce(title_romaji,  '') ~* '\mPart\s+[2-9]\M'
         or coalesce(title_english, '') ~* '\mPart\s+[2-9]\M'
         or coalesce(title_romaji,  '') ~* '\mArc\s*$'
         or coalesce(title_english, '') ~* '\mArc\s*$'
         or coalesce(title_romaji,  '') ~* '\mThe\s+Final\M'
         or coalesce(title_english, '') ~* '\mThe\s+Final\M'
         or coalesce(title_romaji,  '') ~* '\mSpecial\s+[0-9]'
         or coalesce(title_english, '') ~* '\mSpecial\s+[0-9]'
         or coalesce(title_romaji,  '') ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$'
         or coalesce(title_english, '') ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$'
         or (title_romaji is null and title_english is null and (
                 coalesce(title, '') ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
              or coalesce(title, '') ~* '\mSeason\s+[2-9][0-9]?\M'
              or coalesce(title, '') ~* '\mFinal\s+Season\M'
              or coalesce(title, '') ~* '\mCour\s+[2-9]\M'
              or coalesce(title, '') ~* '\mPart\s+[2-9]\M'
              or coalesce(title, '') ~* '\mArc\s*$'
              or coalesce(title, '') ~* '\mThe\s+Final\M'
              or coalesce(title, '') ~* '\mSpecial\s+[0-9]'
              or coalesce(title, '') ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$'
            ))
         );

  -- -----------------------------------------------------------------------
  -- Step 3: Entries with franchise_root_id IS NOT NULL → franchise_child.
  -- franchise_root_id is written by resolve_franchise_roots() and by the
  -- anime_set_canonical() trigger when franchise_root_id is explicitly set.
  -- -----------------------------------------------------------------------
  update public.anime
  set    catalog_type = 'franchise_child'
  where  franchise_root_id is not null
    and  catalog_type != 'franchise_child';

  -- -----------------------------------------------------------------------
  -- Step 4: Same-title TV / TV_SHORT duplicates → franchise_child (loser).
  -- When two non-child TV entries share the same resolved display title,
  -- the loser is demoted.  Winner: earlier season_year > AniList row >
  -- lower anilist_id.  Runs after Steps 2–3 so labeled/attributed entries
  -- don't compete.
  -- -----------------------------------------------------------------------
  update public.anime as a
  set    catalog_type = 'franchise_child'
  where  a.format in ('TV', 'TV_SHORT')
    and  a.catalog_type != 'franchise_child'
    and  exists (
           select 1
           from   public.anime as b
           where  b.format in ('TV', 'TV_SHORT')
             and  b.catalog_type != 'franchise_child'
             and  b.id != a.id
             and  lower(coalesce(a.title_english, a.title_romaji, a.title))
                  = lower(coalesce(b.title_english, b.title_romaji, b.title))
             and  (
                    coalesce(b.season_year, 9999) < coalesce(a.season_year, 9999)
                    or (
                          coalesce(b.season_year, 9999) = coalesce(a.season_year, 9999)
                      and b.anilist_id is not null
                      and a.anilist_id is null
                    )
                    or (
                          coalesce(b.season_year, 9999) = coalesce(a.season_year, 9999)
                      and b.anilist_id is not null
                      and a.anilist_id is not null
                      and b.anilist_id < a.anilist_id
                    )
                  )
         );

  -- -----------------------------------------------------------------------
  -- Step 5: MOVIE / OVA / ONA / SPECIAL whose title is prefixed by a
  -- non-child TV entry → franchise_child.
  --
  -- Standalone films (Your Name, A Silent Voice) have no matching TV prefix
  -- and remain standalone_work.
  --
  -- Runs after Steps 2–4 so only the final non-franchise_child TV set is
  -- used as the match pool.
  -- -----------------------------------------------------------------------
  update public.anime as m
  set    catalog_type = 'franchise_child'
  where  m.format in ('MOVIE', 'OVA', 'ONA', 'SPECIAL')
    and  m.catalog_type != 'franchise_child'
    and  exists (
           select 1
           from   public.anime as tv
           where  tv.format in ('TV', 'TV_SHORT')
             and  tv.catalog_type != 'franchise_child'
             and  tv.id != m.id
             and  (
                    (     tv.title_english is not null
                      and char_length(tv.title_english) >= 6
                      and (    lower(coalesce(m.title_english, '')) like lower(tv.title_english) || ' %'
                            or lower(coalesce(m.title_english, '')) like lower(tv.title_english) || ':%'
                            or lower(coalesce(m.title_english, '')) =    lower(tv.title_english)
                          )
                    )
                    or
                    (     tv.title_romaji is not null
                      and char_length(tv.title_romaji) >= 6
                      and (    lower(coalesce(m.title_romaji, '')) like lower(tv.title_romaji) || ' %'
                            or lower(coalesce(m.title_romaji, '')) like lower(tv.title_romaji) || ':%'
                            or lower(coalesce(m.title_romaji, '')) =    lower(tv.title_romaji)
                          )
                    )
                    or
                    (     tv.title_romaji is null
                      and tv.title_english is null
                      and char_length(tv.title) >= 6
                      and (    lower(coalesce(m.title, '')) like lower(tv.title) || ' %'
                            or lower(coalesce(m.title, '')) like lower(tv.title) || ':%'
                            or lower(coalesce(m.title, '')) =    lower(tv.title)
                          )
                    )
                  )
         );

  -- -----------------------------------------------------------------------
  -- Step 6: TV / TV_SHORT entries that are the root of at least one
  -- franchise_child entry → series_root.
  --
  -- FIX (Bug A): Two-arm EXISTS replaces the single franchise_root_id FK check.
  --
  --   Arm (a) — explicit FK match: c.franchise_root_id = r.id
  --     Covers entries where resolve_franchise_roots() already linked children.
  --
  --   Arm (b) — title-prefix match for franchise_child entries where
  --             franchise_root_id IS NULL (label-detected but not yet resolved)
  --     Covers the case where prequel_anilist_id was never populated and
  --     resolve_franchise_roots() hasn't run yet this pass.
  --     Example: "Jujutsu Kaisen Season 2" is franchise_child by label (Step 2)
  --     but has franchise_root_id = NULL — Arm (b) still promotes Season 1.
  --
  -- Only standalone_work entries are candidates (already-demoted entries cannot
  -- be roots).  This is the only place series_root is assigned.
  -- -----------------------------------------------------------------------
  update public.anime as r
  set    catalog_type = 'series_root'
  where  r.format in ('TV', 'TV_SHORT')
    and  r.catalog_type = 'standalone_work'
    and  (
           -- Arm (a): has explicitly-linked franchise_child children
           exists (
             select 1
             from   public.anime as c
             where  c.franchise_root_id = r.id
               and  c.catalog_type = 'franchise_child'
           )
           or
           -- Arm (b): has label-detected franchise_child children matching by title prefix
           exists (
             select 1
             from   public.anime as c
             where  c.format in ('TV', 'TV_SHORT')
               and  c.catalog_type = 'franchise_child'
               and  c.franchise_root_id is null            -- not yet linked
               and  (
                      (     r.title_english is not null
                        and char_length(r.title_english) >= 6
                        and (    lower(coalesce(c.title_english, ''))
                                     like lower(r.title_english) || ' %'
                              or lower(coalesce(c.title_english, ''))
                                     like lower(r.title_english) || ':%'
                            )
                      )
                      or
                      (     r.title_romaji is not null
                        and char_length(r.title_romaji) >= 6
                        and (    lower(coalesce(c.title_romaji, ''))
                                     like lower(r.title_romaji) || ' %'
                              or lower(coalesce(c.title_romaji, ''))
                                     like lower(r.title_romaji) || ':%'
                            )
                      )
                    )
           )
         );

  -- -----------------------------------------------------------------------
  -- Step 7: Sync is_canonical for backward compatibility.
  -- is_canonical = true  ↔  catalog_type IN ('series_root', 'standalone_work')
  -- is_canonical = false ↔  catalog_type = 'franchise_child'
  -- Only updates mismatched rows to avoid unnecessary WAL writes.
  -- -----------------------------------------------------------------------
  update public.anime
  set    is_canonical = (catalog_type != 'franchise_child')
  where  is_canonical != (catalog_type != 'franchise_child');

end;
$$;

comment on function public.reclassify_catalog() is
  'Authoritative full-catalog reclassification.  Re-evaluates catalog_type for
   ALL rows and ALL formats using the current DB state.  Called by refresh_catalog().
   Steps:
     1. Reset all            → standalone_work
     2. TV sequel labels     → franchise_child
     3. franchise_root_id    → franchise_child
     4. Same-title TV dedup  → franchise_child (loser)
     5. MOVIE/OVA prefix     → franchise_child
     6. TV with children     → series_root  (two-arm: FK + title-prefix)
     7. Sync is_canonical
   Step 6 uses both franchise_root_id FK (Arm a) and title-prefix matching
   (Arm b) to find children, so series_root promotion works even when
   franchise_root_id has not yet been populated for label-detected children.
   Idempotent — safe to call multiple times.';


-- =============================================================================
-- Part 3 — Updated refresh_franchise_episode_totals()
--
-- Changes vs migration 020:
--   - Uses catalog_type instead of is_canonical throughout.
--   - Explicitly NULLs out franchise_episode_total for franchise_child rows.
--     Totals must never appear on hidden entries.
-- =============================================================================

create or replace function public.refresh_franchise_episode_totals()
returns void
language sql
security definer
set search_path = public
as $$
  -- Ensure franchise_child rows never carry a total.
  update public.anime
  set    franchise_episode_total = null
  where  catalog_type = 'franchise_child'
    and  franchise_episode_total is not null;

  -- Reset canonical entries before recompute.
  update public.anime
  set    franchise_episode_total = null
  where  catalog_type in ('series_root', 'standalone_work');

  -- Recompute totals for canonical entries only.
  update public.anime as a
  set    franchise_episode_total = (
           select nullif(
                    sum(
                      coalesce(
                        s.episodes,
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
                    -- (a) self — canonical entry itself contributes its own episodes
                    s.id = a.id
                    or
                    -- (b) explicitly linked child
                    s.franchise_root_id = a.id
                    or
                    -- (c) title-prefix safety net (franchise_root_id still NULL)
                    (     s.catalog_type      = 'franchise_child'
                      and s.franchise_root_id is null
                      and s.anilist_id        is not null
                      and (
                            (     a.title_english is not null
                              and char_length(a.title_english) >= 6
                              and (    lower(coalesce(s.title_english, ''))
                                           like lower(a.title_english) || ' %'
                                    or lower(coalesce(s.title_english, ''))
                                           like lower(a.title_english) || ':%'
                                    or lower(coalesce(s.title_english, ''))
                                            =   lower(a.title_english)
                                  )
                            )
                            or
                            (     a.title_romaji is not null
                              and char_length(a.title_romaji) >= 6
                              and (    lower(coalesce(s.title_romaji, ''))
                                           like lower(a.title_romaji) || ' %'
                                    or lower(coalesce(s.title_romaji, ''))
                                           like lower(a.title_romaji) || ':%'
                                    or lower(coalesce(s.title_romaji, ''))
                                            =   lower(a.title_romaji)
                                  )
                            )
                            or
                            (     a.title_romaji  is null
                              and a.title_english is null
                              and char_length(a.title) >= 6
                              and (    lower(coalesce(s.title, ''))
                                           like lower(a.title) || ' %'
                                    or lower(coalesce(s.title, ''))
                                           like lower(a.title) || ':%'
                                    or lower(coalesce(s.title, ''))
                                            =   lower(a.title)
                                  )
                            )
                          )
                    )
                  )
         )
  where  a.catalog_type in ('series_root', 'standalone_work');
$$;

comment on function public.refresh_franchise_episode_totals() is
  'Recomputes franchise_episode_total for canonical anime entries.
   Explicitly NULLs franchise_episode_total for franchise_child rows.
   Totals are computed for series_root and standalone_work only.
   Uses catalog_type instead of is_canonical throughout.
   Episode contribution per source row:
     COALESCE(episodes, next_airing_episode-1 (if RELEASING), episode_count, 0).
   Idempotent — safe to call multiple times.';


-- =============================================================================
-- Part 4 — Updated refresh_catalog() pipeline
--
-- Order change vs migration 019:
--   OLD: resolve → reclass → resolve → reclass → totals → search
--   NEW: reclass → resolve → reclass → resolve → reclass → totals → search
--
-- Starting with reclassify_catalog() ensures catalog_type is clean before
-- resolve_franchise_roots() uses it for root detection.  The extra reclass at
-- the start is cheap (all rows → standalone_work, then label detection) and
-- eliminates the "stale catalog_type causes wrong root match" failure mode.
-- =============================================================================

create or replace function public.refresh_catalog()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Pass A: Initial classification.
  -- Establishes clean catalog_type from label patterns and any existing
  -- franchise_root_id values.  resolve_franchise_roots() in Pass B will then
  -- have accurate catalog_type state for root detection.
  perform public.reclassify_catalog();

  -- Pass B: Franchise chain resolution using clean catalog_type.
  -- Populates franchise_root_id for entries resolved via prequel_anilist_id
  -- chains (Steps 2–3), subtitle-colon fallback (Steps 4–5), and title-prefix
  -- fallback (Steps 6–7).
  perform public.resolve_franchise_roots();

  -- Pass C: Reclassification with updated franchise_root_id.
  -- Step 3 now demotes all franchise_root_id-linked entries to franchise_child.
  -- Step 5 re-evaluates MOVIE/OVA franchise detection against the stable TV set.
  -- Step 6 promotes series_root using both FK and title-prefix arms.
  perform public.reclassify_catalog();

  -- Pass D: Re-anchor chains against the stable canonical set.
  -- Dedup (Step 4 of Pass C) may have changed canonical state for some TV entries.
  -- This pass resets and repopulates franchise_root_id so no child points to a
  -- dedup loser or other entry that became franchise_child in Pass C.
  perform public.resolve_franchise_roots();

  -- Pass E: Final stable classification.
  -- All franchise_root_id values are now anchored to final, non-child roots.
  -- Promotes any remaining series_root candidates missed by earlier passes.
  perform public.reclassify_catalog();

  -- Compute episode totals against the final catalog_type state.
  -- franchise_child totals are NULLed; series_root/standalone_work totals recomputed.
  perform public.refresh_franchise_episode_totals();

  -- Full recompute of title_normalized (spaced + spaceless forms).
  perform public.refresh_title_normalized();
end;
$$;

comment on function public.refresh_catalog() is
  'Full automatic catalog pipeline.  Safe after any import.  Idempotent.

   Pass A: reclassify_catalog()                — clean-slate classification
   Pass B: resolve_franchise_roots()           — populate franchise_root_id
   Pass C: reclassify_catalog()                — classify with updated chains
   Pass D: resolve_franchise_roots()           — re-anchor against stable roots
   Pass E: reclassify_catalog()                — final stable classification
   Totals: refresh_franchise_episode_totals()  — franchise episode sums
   Search: refresh_title_normalized()          — full title_normalized recompute

   Starting with reclassify (Pass A) ensures catalog_type is clean before
   resolve_franchise_roots() uses it for root detection, eliminating the
   stale-is_canonical failure mode present in migrations 018–019.';


-- =============================================================================
-- Part 5 — Immediate cleanup
-- =============================================================================

select public.refresh_catalog();
