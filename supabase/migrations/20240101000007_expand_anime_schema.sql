-- =============================================================================
-- Migration: expand_anime_schema (Milestone 3.5)
-- Adds AniList-sourced metadata columns to the anime catalogue.
-- Existing rows are unaffected — all new columns are nullable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------
alter table public.anime
  add column if not exists anilist_id         integer,
  add column if not exists title_romaji       text,
  add column if not exists title_english      text,
  add column if not exists title_native       text,
  add column if not exists cover_image_large  text,
  add column if not exists cover_image_medium text,
  add column if not exists description        text,
  add column if not exists format             text,
  add column if not exists status             text,
  add column if not exists season_year        integer,
  add column if not exists episodes           integer;

-- ---------------------------------------------------------------------------
-- 2. Constraints
-- ---------------------------------------------------------------------------

-- Deduplication key — one row per AniList media ID
alter table public.anime
  add constraint anime_anilist_id_unique
    unique (anilist_id);

-- Format must be a recognised AniList format string (or null for legacy rows)
alter table public.anime
  add constraint anime_format_valid
    check (format is null or format in (
      'TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'
    ));

-- Status must be a recognised AniList status string (or null for legacy rows)
alter table public.anime
  add constraint anime_status_valid
    check (status is null or status in (
      'FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS'
    ));

-- episodes (new field) must be positive if set
alter table public.anime
  add constraint anime_episodes_positive
    check (episodes is null or episodes > 0);

-- season_year must be a plausible year if set
alter table public.anime
  add constraint anime_season_year_valid
    check (season_year is null or season_year between 1900 and 2100);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

-- Replace the single-column GIN index with one that covers all title variants
-- so search works across romaji / english / legacy title columns.
drop index if exists anime_title_search_idx;
create index anime_title_search_idx on public.anime using gin (
  to_tsvector('english',
    coalesce(title, '')         || ' ' ||
    coalesce(title_romaji, '')  || ' ' ||
    coalesce(title_english, '')
  )
);

-- Fast deduplication lookup by AniList ID
create index if not exists anime_anilist_id_idx
  on public.anime (anilist_id)
  where anilist_id is not null;

-- Fast filter by format (TV, MOVIE, etc.)
create index if not exists anime_format_idx
  on public.anime (format);
