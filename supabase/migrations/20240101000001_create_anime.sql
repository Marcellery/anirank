-- =============================================================================
-- Migration: create_anime
-- Depends on: nothing
--
-- Global catalogue of anime. Populated by admins / seed scripts, not by users.
-- Users reference rows from this table via user_anime and user_rankings.
-- =============================================================================

create type public.anime_type as enum ('series', 'movie');

create table public.anime (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  poster         text,                        -- URL to poster image
  type           public.anime_type not null,
  episode_count  integer,                     -- null for movies or unknown
  release_year   integer,
  created_at     timestamptz not null default now(),

  constraint anime_title_not_empty  check (char_length(title) > 0),
  constraint anime_episode_count_positive check (episode_count is null or episode_count > 0),
  constraint anime_release_year_valid     check (release_year is null or release_year between 1900 and 2100)
);

-- Fast title search used during onboarding and battle pair selection
create index anime_title_search_idx on public.anime using gin (to_tsvector('english', title));
create index anime_type_idx         on public.anime (type);
create index anime_release_year_idx on public.anime (release_year);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.anime enable row level security;

-- All authenticated users can read the catalogue
create policy "anime: authenticated users can read"
  on public.anime for select
  to authenticated
  using (true);

-- Only service role (admin / seed scripts) can insert, update, delete
-- No user-facing insert policy — enforced by omission
