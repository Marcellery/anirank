-- =============================================================================
-- Migration: normalized_search (Milestone 3 — punctuation-insensitive search)
--
-- Problem: searching "dr stone" does not match "Dr. STONE" because the raw
-- title contains a period, a space, and mixed case.  Similarly, "kaguya sama"
-- misses "Kaguya-sama: Love Is War" (hyphen + colon) and "dont toy with me"
-- misses "DON'T TOY WITH ME, MISS NAGATORO" (apostrophe + comma).
--
-- Fix:
--   1. normalize_title() — immutable SQL function that:
--        • lowercases the input
--        • replaces word-separating punctuation (. : - / \) with a space
--        • removes remaining non-alphanumeric chars (apostrophes, commas, etc.)
--        • collapses multiple spaces and trims
--
--   2. title_normalized text column — stores
--        normalize_title(title_english || ' ' || title_romaji || ' ' || title)
--      so every title variant is searchable from a single column.
--
--   3. pg_trgm GIN index on title_normalized — makes ILIKE '%pattern%' fast
--      (Supabase enables pg_trgm by default).
--
--   4. BEFORE INSERT OR UPDATE trigger — keeps title_normalized current
--      whenever a title column is written.
--
-- The search function in anime.service.ts applies the same normalization to
-- the user's query string before building the ILIKE pattern.
-- =============================================================================

-- =============================================================================
-- Part 1 — normalize_title() helper
-- =============================================================================

create or replace function public.normalize_title(t text)
returns text
immutable strict parallel safe
language sql
as $$
  select trim(
    regexp_replace(
      -- Step 3: collapse multiple spaces to one
      regexp_replace(
        -- Step 2: remove remaining non-alphanumeric characters
        --         (apostrophes, commas, exclamation marks, special chars, etc.)
        regexp_replace(
          -- Step 1: replace word-separating punctuation with a space
          lower(t),
          '[.:\-/\\]',
          ' ',
          'g'
        ),
        '[^a-z0-9 ]',
        '',
        'g'
      ),
      '\s+',
      ' ',
      'g'
    )
  )
$$;

comment on function public.normalize_title(text) is
  'Normalise a title string for fuzzy search: lowercase, replace punctuation
   separators (.:/-\) with spaces, strip remaining non-alphanumeric chars,
   collapse whitespace.  Must match the normaliseQuery() helper in TypeScript.';

-- =============================================================================
-- Part 2 — title_normalized column
-- =============================================================================

alter table public.anime
  add column if not exists title_normalized text;

comment on column public.anime.title_normalized is
  'Punctuation-stripped, lowercased concatenation of title_english, title_romaji,
   and title.  Used for fuzzy ILIKE search.  Maintained by trigger
   anime_set_title_normalized.  Run normalize_title() on the search query before
   querying this column.';

-- Backfill all existing rows (idempotent: safe to re-run)
update public.anime
set    title_normalized = public.normalize_title(
         coalesce(title_english, '') || ' ' ||
         coalesce(title_romaji,  '') || ' ' ||
         title
       );

-- =============================================================================
-- Part 3 — pg_trgm GIN index for fast ILIKE
-- =============================================================================

-- pg_trgm is pre-installed on Supabase; this is a no-op if already enabled.
create extension if not exists pg_trgm;

create index if not exists anime_title_normalized_gin
  on public.anime
  using gin (title_normalized gin_trgm_ops)
  where is_canonical = true;

-- =============================================================================
-- Part 4 — trigger: keep title_normalized up to date
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

drop trigger if exists anime_set_title_normalized on public.anime;

create trigger anime_set_title_normalized
  before insert or update of title, title_romaji, title_english
  on public.anime
  for each row
  execute function public.set_anime_title_normalized();
