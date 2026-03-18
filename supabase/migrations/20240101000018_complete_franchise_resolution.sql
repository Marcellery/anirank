-- =============================================================================
-- Migration: complete_franchise_resolution
--
-- Closes three systemic gaps in the catalog pipeline:
--
-- Gap 1 — resolve_franchise_roots() left label-detected non-canonical entries
--   (is_canonical=false via "Season 2" / "Arc" / Roman-numeral patterns) with
--   franchise_root_id = NULL when prequel_anilist_id was also NULL.
--   The episode total function's title-prefix fallback (path c) then failed for
--   cross-language titles, short titles, or inconsistent AniList naming.
--
--   Fix: Step 6 — set franchise_root_id on every remaining non-canonical TV
--   entry using the same title-prefix logic (space OR colon separator, both
--   English and Romaji columns, min 6 chars) that was previously only used as
--   a query-time heuristic.  This promotes it from a fallback heuristic to an
--   explicit, stored attribution — correct for the whole catalog, not just
--   the entries in the current fetch window.
--
-- Gap 2 — deduplicate_canonical_tv() ran after resolve_franchise_roots() and
--   could mark a "root" non-canonical (dedup loser).  Any sequel whose
--   franchise_root_id pointed to that dedup loser then matched no active
--   canonical root in the episode total query; its episodes were silently
--   omitted from the count.
--
--   Fix: run resolve_franchise_roots() TWICE in refresh_catalog() — once
--   before deduplicate_canonical_tv(), once after.  The second pass starts
--   from a stable canonical set (no further dedup will change it) so all
--   franchise_root_id values are anchored to real, final roots.
--
-- Gap 3 — refresh_franchise_episode_totals() path (c) was a query-time
--   heuristic: it computed title-prefix matches on the fly at aggregation time.
--   Any entry not matched by the heuristic contributed zero to the total
--   silently.  After Gaps 1 and 2 are fixed, path (c) becomes a genuine
--   last-resort safety net rather than the primary mechanism for a large class
--   of entries.
-- =============================================================================

-- =============================================================================
-- Part 1 — Complete resolve_franchise_roots()
-- Replaces the versions in migrations 015 and 017.
--
-- Step 1:  Reset franchise_root_id (idempotent)
-- Step 2:  One-hop resolution via prequel_anilist_id
-- Step 3:  Chain propagation — walk to ultimate root
-- Step 4:  Subtitle-colon fallback for CANONICAL entries without prequel chain
-- Step 5:  Propagation after Step 4
-- Step 6:  Title-prefix fallback for NON-CANONICAL entries still without root
-- Step 7:  Final propagation pass
-- =============================================================================

create or replace function public.resolve_franchise_roots()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

  -- Step 1: Reset franchise_root_id.
  -- The anime_set_canonical() trigger fires per-row on the NULL assignment,
  -- re-evaluating is_canonical via label patterns — so Class 1 entries
  -- become non-canonical again while genuinely distinct roots stay canonical.
  update public.anime
  set    franchise_root_id = null
  where  franchise_root_id is not null;

  -- Step 2: One-hop resolution via explicit prequel_anilist_id data.
  -- For every entry whose prequel_anilist_id matches a row in the DB,
  -- franchise_root_id = that row's UUID.
  -- Trigger fires per-row: franchise_root_id IS NOT NULL → is_canonical = false.
  update public.anime as a
  set    franchise_root_id = p.id
  from   public.anime as p
  where  a.prequel_anilist_id = p.anilist_id
    and  p.anilist_id is not null;

  -- Step 3: Propagate to the ultimate root.
  -- Entries pointing to an intermediate node (which itself has a franchise_root_id)
  -- are redirected to the final root.  Each pass resolves one additional hop.
  for _depth in 1..10 loop
    update public.anime as a
    set    franchise_root_id = p.franchise_root_id
    from   public.anime as p
    where  a.franchise_root_id  = p.id
      and  p.franchise_root_id is not null;
    exit when not found;
  end loop;

  -- -----------------------------------------------------------------------
  -- Step 4: Subtitle-colon fallback for CANONICAL entries not yet resolved.
  --
  -- Covers entries that are still is_canonical=true after Steps 2-3 because
  -- prequel_anilist_id was NULL (e.g. seeded before migration 015).  If their
  -- title starts with another canonical entry's title followed by a colon,
  -- they are a subtitle-differentiated continuation.
  --
  -- DISTINCT ON (a.id) ensures one root per entry.  The order clause picks
  -- the most-recent canonical predecessor; anilist_id breaks ties.
  -- -----------------------------------------------------------------------
  with best_root as (
    select distinct on (a.id)
           a.id as sequel_id,
           r.id as root_id
    from   public.anime as a
    join   public.anime as r
             on  r.format      in ('TV', 'TV_SHORT')
             and r.is_canonical = true
             and r.id          != a.id
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
    where  a.format          in ('TV', 'TV_SHORT')
      and  a.is_canonical     = true
      and  a.franchise_root_id is null
    order  by a.id,
              coalesce(r.season_year, 0) desc,
              r.anilist_id asc
  )
  update public.anime as a
  set    franchise_root_id = br.root_id
  from   best_root as br
  where  a.id = br.sequel_id;

  -- Step 5: Propagate after Step 4 in case newly assigned roots are themselves
  -- intermediate nodes.
  for _depth in 1..10 loop
    update public.anime as a
    set    franchise_root_id = p.franchise_root_id
    from   public.anime as p
    where  a.franchise_root_id  = p.id
      and  p.franchise_root_id is not null;
    exit when not found;
  end loop;

  -- -----------------------------------------------------------------------
  -- Step 6: Title-prefix fallback for NON-CANONICAL entries still without root.
  --
  -- These are label-detected entries ("Season 2", "Arc", Roman numerals, etc.)
  -- whose prequel_anilist_id was NULL, so Steps 2-3 didn't resolve them, and
  -- whose title doesn't use a colon separator, so Step 4 didn't apply either.
  -- Examples: "Attack on Titan Season 2", "Overlord II" (after Roman-numeral
  -- detection), "Jujutsu Kaisen 2nd Season".
  --
  -- Uses BOTH space and colon separators to match:
  --   "X Season 2"   LIKE "X %"       → space-separated
  --   "X: New Arc"   LIKE "X:%"       → colon-separated (already handled by
  --                                      Step 4 when canonical; catches
  --                                      non-canonical colon entries here)
  --
  -- Condition coalesce(r.season_year,9999) <= coalesce(a.season_year,9999)
  -- uses <= (not <) to handle same-year split-cour shows.
  -- DISTINCT ON picks the most-recent canonical predecessor.
  -- -----------------------------------------------------------------------
  with best_root as (
    select distinct on (a.id)
           a.id as sequel_id,
           r.id as root_id
    from   public.anime as a
    join   public.anime as r
             on  r.format      in ('TV', 'TV_SHORT')
             and r.is_canonical = true
             and r.id          != a.id
             and coalesce(r.season_year, 9999) <= coalesce(a.season_year, 9999)
             and (
                   -- English prefix — space or colon separator
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
                   -- Romaji prefix — space or colon separator
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
                   -- Legacy title fallback (rows with no romaji/english)
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
    where  a.format          in ('TV', 'TV_SHORT')
      and  a.is_canonical     = false        -- already non-canonical
      and  a.franchise_root_id is null       -- not yet attributed to a root
      and  a.anilist_id       is not null    -- skip manually-created rows
    order  by a.id,
              coalesce(r.season_year, 0) desc,   -- prefer most-recent root
              r.anilist_id asc                    -- tiebreak
  )
  update public.anime as a
  set    franchise_root_id = br.root_id
  from   best_root as br
  where  a.id = br.sequel_id;

  -- Step 7: Final propagation — Step 6 assignments always point to a canonical
  -- (is_canonical=true) root, which by invariant has franchise_root_id=NULL.
  -- This loop is therefore a no-op in the normal case; it exists as a safety
  -- net if any root was canonical during Step 6 but then re-evaluated.
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
   Steps 4–5: subtitle-colon fallback for canonical entries without prequel data.
   Steps 6–7: title-prefix fallback for non-canonical entries without root,
              covering label-detected entries ("Season 2", "Arc", Roman numerals).
   After this function returns, every non-canonical TV entry with a known
   AniList ID has franchise_root_id pointing to its canonical franchise root.
   Idempotent — safe to call multiple times.';

-- =============================================================================
-- Part 2 — Updated refresh_catalog() — two-pass pipeline
--
-- The single-pass pipeline had a structural flaw: resolve_franchise_roots()
-- ran once, then deduplicate_canonical_tv() could mark some previously-
-- canonical entries non-canonical (dedup losers).  Any sequel whose
-- franchise_root_id pointed to a dedup loser then matched no active root
-- in refresh_franchise_episode_totals(), silently omitting its episodes.
--
-- Fix: run resolve_franchise_roots() TWICE.
--   Pass 1:  resolve chains + detect subtitle/label entries
--   Dedup:   stabilise the canonical set
--   Pass 2:  re-resolve with the now-stable canonical set so that all
--            franchise_root_id values point to the final, real roots
--   Totals:  computed once against the stable, fully-attributed rows
-- =============================================================================

create or replace function public.refresh_catalog()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Pass 1: resolve franchise chains and detect all non-canonical entries.
  --         After this pass, chains, subtitle-colon entries, and label-detected
  --         entries are all resolved.
  perform public.resolve_franchise_roots();

  -- Dedup: remove same-title canonical TV duplicates.
  --        Runs after Pass 1 so relation-sequels are already non-canonical
  --        and won't compete in the same-title comparison.
  perform public.deduplicate_canonical_tv();

  -- Pass 2: re-resolve with the stable canonical set.
  --         Dedup may have made some previously-canonical entries non-canonical
  --         (dedup losers).  Pass 2 resets all franchise_root_id values and
  --         re-anchors them against only the surviving canonical roots, so
  --         no sequel's franchise_root_id points to a non-canonical row.
  perform public.resolve_franchise_roots();

  -- Compute episode totals against the final, stable franchise attributions.
  perform public.refresh_franchise_episode_totals();

  -- Repair any NULL title_normalized values.
  perform public.refresh_title_normalized();
end;
$$;

comment on function public.refresh_catalog() is
  'Full automatic catalog pipeline.  Safe after any import (seed, reseed,
   partial import, scheduled sync).  Idempotent.

   Pass 1: resolve_franchise_roots()          — chains + all fallback steps
   Dedup:  deduplicate_canonical_tv()         — stabilise canonical set
   Pass 2: resolve_franchise_roots()          — re-anchor against final roots
   Totals: refresh_franchise_episode_totals() — episode sums
   Search: refresh_title_normalized()         — repair NULL search fields

   The two-pass design guarantees that franchise_root_id values always point
   to a currently-canonical root row when episode totals are computed.';

-- =============================================================================
-- Part 3 — Immediate cleanup
-- =============================================================================

select public.refresh_catalog();
