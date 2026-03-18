-- =============================================================================
-- Migration: catalog_architecture (019)
--
-- Replaces the boolean is_canonical model with an explicit three-state
-- catalog_type classification:
--
--   series_root    — canonical first entry of a multi-season franchise.
--                    Aggregates franchise_episode_total across all children.
--   standalone_work — self-contained entry: single-season TV show, or
--                    standalone film (Your Name, A Silent Voice).
--                    Always selectable.
--   franchise_child — hidden from catalog: sequel seasons, arcs,
--                    franchise-attached movies (Jujutsu Kaisen 0),
--                    OVAs/specials belonging to a franchise.
--
-- Selectable catalog = catalog_type IN ('series_root', 'standalone_work')
--                    = is_canonical = true  (kept in sync for backward compat)
--
-- Fixes four systemic problems:
--
--   Problem 1 — refresh_catalog() never re-evaluated MOVIE/OVA/SPECIAL
--     is_canonical after the pipeline changed TV canonical state.  The Class 2
--     trigger ran only at INSERT/UPDATE time; franchise-attached movies seeded
--     before their parent TV series had stale is_canonical = true forever.
--     Fix: reclassify_catalog() Step 5 re-runs Class 2 inside refresh_catalog().
--
--   Problem 2 — Spaceless search queries ("oshinoko", "drstone") always
--     returned zero results.  normalize_title() produced only a spaced form
--     ("oshi no ko"); ILIKE '%oshinoko%' found no match.
--     Fix: normalize_title() now appends a spaceless variant so title_normalized
--     stores both "oshi no ko" and "oshinoko" in a single column.
--
--   Problem 3 — refresh_title_normalized() only patched NULL values, leaving
--     stale non-NULL values from pre-014 rows uncorrected.
--     Fix: full recompute — WHERE title_normalized IS NULL removed.
--
--   Problem 4 — is_canonical conflated series_root and standalone_work,
--     making it impossible to distinguish standalone films from franchise roots
--     without inspecting children.
--     Fix: catalog_type column with explicit three-state semantics.
--
-- Parts:
--   1. catalog_type column + index
--   2. normalize_title() with spaceless variant
--   3. set_anime_title_normalized() trigger (recompile against new normalize_title)
--   4. anime_set_canonical() trigger (sets catalog_type + is_canonical)
--   5. reclassify_catalog() function
--   6. refresh_title_normalized() full recompute
--   7. refresh_catalog() updated pipeline
--   8. GIN index rebuild
--   9. Immediate cleanup run
-- =============================================================================


-- =============================================================================
-- Part 1 — catalog_type column
-- =============================================================================

alter table public.anime
  add column if not exists catalog_type text
    not null default 'standalone_work'
    check (catalog_type in ('series_root', 'standalone_work', 'franchise_child'));

comment on column public.anime.catalog_type is
  'Three-state catalog classification.  Source of truth for all catalog decisions.
   series_root    — canonical first entry of a multi-season franchise;
                    franchise_episode_total aggregates across all children.
   standalone_work — self-contained entry (single-season show or standalone film);
                    always selectable.
   franchise_child — hidden: sequel seasons, arcs, franchise movies, OVAs/specials
                    attached to a franchise.
   Selectable catalog = catalog_type IN (''series_root'', ''standalone_work'').
   is_canonical is kept in sync as a backward-compatibility alias: true when
   catalog_type != ''franchise_child''.';

-- Partial index on hidden entries (small set; helps planner skip them cheaply).
create index if not exists anime_catalog_type_idx
  on public.anime (catalog_type)
  where catalog_type = 'franchise_child';


-- =============================================================================
-- Part 2 — normalize_title(): spaced + spaceless variant
--
-- Previous output: "oshi no ko oshi no ko oshi no ko"
-- New output:      "oshi no ko oshi no ko oshi no ko oshinokooshinokooshinoko"
--
-- The spaceless suffix is replace(spaced_result, ' ', ''), computed once via
-- an inline subquery so the regex chain runs only once.
--
-- Why this works for search:
--   Query "oshinoko"     → ILIKE '%oshinoko%'     → matches spaceless suffix ✓
--   Query "oshi no ko"   → ILIKE '%oshi no ko%'   → matches spaced prefix    ✓
--   Query "oshi"         → ILIKE '%oshi%'          → matches both parts       ✓
--   Query "drstone"      → ILIKE '%drstone%'       → matches spaceless suffix ✓
--   Query "dr stone"     → ILIKE '%dr stone%'      → matches spaced prefix    ✓
--   Query "jujutsukaisen"→ ILIKE '%jujutsukaisen%' → matches spaceless suffix ✓
--
-- TypeScript normaliseQuery() is unchanged — it normalises queries to the
-- spaced form, which matches the spaced part of stored values.  Spaceless
-- queries ("oshinoko") pass through normaliseQuery() unchanged and match the
-- spaceless part directly.
-- =============================================================================

create or replace function public.normalize_title(t text)
returns text
immutable strict parallel safe
language sql
as $$
  select spaced || ' ' || replace(spaced, ' ', '')
  from (
    select trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(t),
            '[.:\-/\\]', ' ', 'g'
          ),
          '[^a-z0-9 ]', '', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ) as spaced
  ) _norm
$$;

comment on function public.normalize_title(text) is
  'Normalise a title string for fuzzy search.
   Returns: spaced_form || '' '' || spaceless_form.
   spaced_form:    lowercase, punctuation separators → spaces, non-alphanumeric
                   stripped, whitespace collapsed.
   spaceless_form: spaced_form with all spaces removed.
   Example: "Oshi no Ko"  → "oshi no ko oshinoko".
   Example: "Dr. STONE"   → "dr stone drstone".
   Example: "Jujutsu Kaisen" → "jujutsu kaisen jujutsukaisen".
   Enables both spaced queries and spaceless queries via a single ILIKE.
   Must remain in sync with normaliseQuery() in TypeScript.';


-- =============================================================================
-- Part 3 — set_anime_title_normalized() trigger
-- Recompile so it calls the updated normalize_title() at runtime.
-- (Function body is unchanged; CREATE OR REPLACE forces recompilation.)
-- =============================================================================

create or replace function public.set_anime_title_normalized()
returns trigger
language plpgsql
as $$
begin
  NEW.title_normalized := public.normalize_title(
    coalesce(NEW.title_english, '') || ' ' ||
    coalesce(NEW.title_romaji,  '') || ' ' ||
    NEW.title
  );
  return NEW;
end;
$$;


-- =============================================================================
-- Part 4 — anime_set_canonical() trigger
--
-- Sets catalog_type (source of truth) and derives is_canonical from it.
-- Handles classification at INSERT/UPDATE time so rows are reasonably
-- classified during imports.  reclassify_catalog() makes it authoritative
-- for all rows after the full pipeline.
--
-- Catalog type assignment:
--   franchise_root_id IS NOT NULL          → franchise_child (always)
--   TV/TV_SHORT sequel-label patterns      → franchise_child
--   MOVIE/OVA/ONA/SPECIAL matching TV prefix → franchise_child
--   everything else                        → standalone_work
--
-- Note: series_root is NOT set here.  Detecting it requires knowing whether
-- any child row has franchise_root_id pointing to this entry — that cross-row
-- check is done by reclassify_catalog() Step 6.  Between imports and the next
-- refresh_catalog() run, series roots appear as standalone_work, which is
-- still selectable (correct behaviour for the app).
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

  -- -------------------------------------------------------------------------
  -- franchise_root_id explicitly set → always franchise_child.
  -- -------------------------------------------------------------------------
  if NEW.franchise_root_id is not null then
    NEW.catalog_type := 'franchise_child';
    NEW.is_canonical := false;
    return NEW;
  end if;

  -- =========================================================================
  -- Class 1: TV / TV_SHORT — sequel-variant label detection.
  -- =========================================================================
  if NEW.format in ('TV', 'TV_SHORT') then

    if (
          t_r ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
       or t_e ~* '\m(2nd|3rd|4th|5th|6th|7th|8th|9th|10th)\s+Season\M'
       or t_r ~* '\mSeason\s+[2-9][0-9]?\M'
       or t_e ~* '\mSeason\s+[2-9][0-9]?\M'
       or t_r ~* '\mFinal\s+Season\M'
       or t_e ~* '\mFinal\s+Season\M'
       or t_r ~* '\mCour\s+[2-9]\M'
       or t_e ~* '\mCour\s+[2-9]\M'
       or t_r ~* '\mPart\s+[2-9]\M'
       or t_e ~* '\mPart\s+[2-9]\M'
       or t_r ~* '\mArc\s*$'
       or t_e ~* '\mArc\s*$'
       or t_r ~* '\mThe\s+Final\M'
       or t_e ~* '\mThe\s+Final\M'
       or t_r ~* '\mSpecial\s+[0-9]'
       or t_e ~* '\mSpecial\s+[0-9]'
       or t_r ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$'
       or t_e ~* '\s+(XII|VIII|VII|III|XI|IV|VI|IX|II|X|V)\s*$'
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
             ))
    ) then
      NEW.catalog_type := 'franchise_child';
      NEW.is_canonical := false;
    else
      -- No label match.  If the row previously held franchise_child from a
      -- stale trigger run, reset it to standalone_work.  reclassify_catalog()
      -- will promote to series_root when children are found.
      if NEW.catalog_type = 'franchise_child' then
        NEW.catalog_type := 'standalone_work';
        NEW.is_canonical := true;
      end if;
    end if;

    return NEW;
  end if;

  -- =========================================================================
  -- Class 2: MOVIE / OVA / ONA / SPECIAL — franchise-movie detection.
  -- Mark franchise_child when this entry's title begins with a selectable TV
  -- entry's title (≥6 chars, space or colon separator, or exact match).
  -- Standalone films with no matching TV prefix remain standalone_work.
  -- =========================================================================
  if NEW.format in ('MOVIE', 'OVA', 'ONA', 'SPECIAL') then

    select exists (
      select 1
      from   public.anime as tv
      where  tv.format in ('TV', 'TV_SHORT')
        and  tv.catalog_type != 'franchise_child'
        and  tv.id != NEW.id
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
      NEW.catalog_type := 'franchise_child';
      NEW.is_canonical := false;
    else
      -- No matching TV prefix: standalone film.
      -- Reset stale franchise_child if present.
      if NEW.catalog_type = 'franchise_child' then
        NEW.catalog_type := 'standalone_work';
        NEW.is_canonical := true;
      end if;
    end if;

  end if;

  return NEW;
end;
$$;

-- Reattach trigger.  Column list unchanged — catalog_type is NOT in the OF
-- list because the trigger manages it internally (not via direct column write).
drop trigger if exists anime_canonicalize on public.anime;

create trigger anime_canonicalize
  before insert or update of title, title_romaji, title_english, format, franchise_root_id
  on public.anime
  for each row
  execute function public.anime_set_canonical();


-- =============================================================================
-- Part 5 — reclassify_catalog()
--
-- Authoritative full-catalog classification for ALL rows and ALL formats.
-- Called twice per refresh_catalog() run to guarantee correctness regardless
-- of import order, prior trigger state, or dedup changes.
--
-- Unlike the trigger, this function:
--   a. Re-evaluates MOVIE/OVA/SPECIAL rows against the current (post-dedup) TV set.
--   b. Detects series_root by checking which TV entries have franchise_child children.
--   c. Runs same-title TV dedup as part of classification (Step 4).
--
-- Steps:
--   1. Reset all rows → standalone_work.
--   2. TV sequel-label patterns       → franchise_child.
--   3. franchise_root_id IS NOT NULL  → franchise_child.
--   4. Same-title TV dedup            → franchise_child (loser).
--   5. MOVIE/OVA/ONA/SPECIAL prefix   → franchise_child.
--   6. TV entries with child rows     → series_root.
--   7. Sync is_canonical.
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
  -- Starting assumption: every entry is independently selectable.
  -- Steps 2–5 demote entries to franchise_child; Step 6 promotes roots.
  -- -----------------------------------------------------------------------
  update public.anime
  set    catalog_type = 'standalone_work'
  where  catalog_type != 'standalone_work';

  -- -----------------------------------------------------------------------
  -- Step 2: TV / TV_SHORT sequel-label patterns → franchise_child.
  -- Mirrors the trigger's Class 1 detection, run as a batch UPDATE.
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
  -- Step 3: Entries with franchise_root_id set → franchise_child.
  -- franchise_root_id is written by resolve_franchise_roots() from
  -- prequel_anilist_id chains and title-prefix fallbacks.
  -- -----------------------------------------------------------------------
  update public.anime
  set    catalog_type = 'franchise_child'
  where  franchise_root_id is not null
    and  catalog_type != 'franchise_child';

  -- -----------------------------------------------------------------------
  -- Step 4: Same-title TV/TV_SHORT duplicates → franchise_child (dedup).
  -- When two non-child TV entries share the same resolved display title,
  -- the loser is demoted.  Winner order: earlier season_year > AniList row
  -- over manual row > lower anilist_id.
  -- Runs after Steps 2–3 so already-demoted entries don't compete.
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
  -- Step 5: MOVIE / OVA / ONA / SPECIAL prefix-matching a non-child TV
  -- entry → franchise_child.
  --
  -- This is the critical fix for franchise-attached movies that were seeded
  -- before their parent TV series: the trigger could not classify them at
  -- insert time because the TV parent was not yet in the DB.  Running this
  -- inside refresh_catalog() guarantees correct classification for all rows
  -- regardless of import order.
  --
  -- Standalone films (Your Name, A Silent Voice, I Want to Eat Your
  -- Pancreas) have no matching TV prefix and remain standalone_work.
  --
  -- Runs after Steps 2–4 so the TV match candidates are the final
  -- non-franchise_child set.
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
  -- Step 6: TV / TV_SHORT entries with at least one franchise_child child
  -- pointing to them via franchise_root_id → series_root.
  --
  -- Only standalone_work entries are promoted (entries already demoted by
  -- Steps 2–5 cannot be roots).  This is the only place series_root is set.
  -- -----------------------------------------------------------------------
  update public.anime as r
  set    catalog_type = 'series_root'
  where  r.format in ('TV', 'TV_SHORT')
    and  r.catalog_type = 'standalone_work'
    and  exists (
           select 1
           from   public.anime as c
           where  c.franchise_root_id = r.id
             and  c.catalog_type = 'franchise_child'
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
   ALL rows and ALL formats using the current DB state.  Called twice by
   refresh_catalog() — after each resolve_franchise_roots() pass.
   Steps:
     1. Reset all          → standalone_work
     2. TV sequel labels   → franchise_child
     3. franchise_root_id  → franchise_child
     4. Same-title TV dedup→ franchise_child (loser)
     5. MOVIE/OVA prefix   → franchise_child
     6. TV with children   → series_root
     7. Sync is_canonical
   Idempotent — safe to call multiple times.';


-- =============================================================================
-- Part 6 — refresh_title_normalized(): full recompute (no WHERE IS NULL)
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
         );
$$;

comment on function public.refresh_title_normalized() is
  'Recomputes title_normalized for ALL rows using the current normalize_title()
   output.  Full recompute (no WHERE IS NULL) corrects stale values from
   pre-014 rows and rows that pre-date the spaceless variant added in 019.
   Called at the end of refresh_catalog().  Idempotent.';


-- =============================================================================
-- Part 7 — refresh_catalog(): updated pipeline
--
-- Order:
--   Pass 1   resolve_franchise_roots()           build franchise_root_id chains
--   Reclass  reclassify_catalog()                full classification + dedup;
--                                                syncs is_canonical
--   Pass 2   resolve_franchise_roots()           re-anchor against stable set
--   Reclass  reclassify_catalog()                final classification
--   Totals   refresh_franchise_episode_totals()  episode aggregation
--   Search   refresh_title_normalized()          title_normalized recompute
-- =============================================================================

create or replace function public.refresh_catalog()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Pass 1: build franchise_root_id chains using prequel_anilist_id data and
  --         title-prefix fallbacks.  Uses current is_canonical to find roots.
  perform public.resolve_franchise_roots();

  -- Reclassification 1: classify ALL rows and formats using Pass 1 state.
  --   Includes same-title dedup (Step 4) and franchise-movie detection (Step 5).
  --   Syncs is_canonical so Pass 2 has accurate root-candidate state.
  perform public.reclassify_catalog();

  -- Pass 2: re-anchor franchise_root_id against the now-stable canonical set.
  --   Dedup (Step 4 above) may have marked some TV entries franchise_child.
  --   Pass 2 re-runs full chain resolution so no sequel's franchise_root_id
  --   points to a dedup loser or other stale root.
  perform public.resolve_franchise_roots();

  -- Reclassification 2: re-classify using Pass 2's updated franchise_root_id.
  --   Ensures catalog_type and is_canonical reflect the final stable state.
  --   Dedup re-runs (idempotent); same losers are identified.
  perform public.reclassify_catalog();

  -- Compute franchise episode totals against the final catalog_type state.
  perform public.refresh_franchise_episode_totals();

  -- Recompute ALL title_normalized values with the spaceless-variant format.
  perform public.refresh_title_normalized();
end;
$$;

comment on function public.refresh_catalog() is
  'Full automatic catalog pipeline.  Safe after any import (seed, reseed,
   partial import, scheduled sync).  Idempotent.

   Pass 1:  resolve_franchise_roots()           — franchise chain resolution
   Reclass: reclassify_catalog()                — full classification + dedup
   Pass 2:  resolve_franchise_roots()           — re-anchor against stable set
   Reclass: reclassify_catalog()                — final stable classification
   Totals:  refresh_franchise_episode_totals()  — franchise episode sums
   Search:  refresh_title_normalized()          — full title_normalized recompute

   catalog_type is the authoritative classification after this function returns.
   is_canonical is kept in sync as a backward-compatibility alias.';


-- =============================================================================
-- Part 8 — GIN index rebuild
--
-- Drop and recreate so the index covers the new title_normalized content
-- (spaced + spaceless) and uses catalog_type in the partial predicate.
-- =============================================================================

drop index if exists anime_title_normalized_gin;

create index anime_title_normalized_gin
  on public.anime
  using gin (title_normalized gin_trgm_ops)
  where catalog_type != 'franchise_child';


-- =============================================================================
-- Part 9 — Immediate cleanup: apply to all existing rows
-- =============================================================================

select public.refresh_catalog();
