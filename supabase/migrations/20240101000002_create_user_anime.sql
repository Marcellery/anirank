-- =============================================================================
-- Migration: create_user_anime
-- Depends on: profiles, anime
--
-- Tracks which anime each user has added to their list and their watch status.
-- Only anime in this list are eligible to appear in battles.
-- =============================================================================

create type public.watch_status as enum (
  'watching',
  'completed',
  'plan_to_watch',
  'dropped'
);

create table public.user_anime (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  anime_id      uuid not null references public.anime (id) on delete cascade,
  watch_status  public.watch_status not null default 'plan_to_watch',
  added_at      timestamptz not null default now(),

  -- One row per user per anime
  constraint user_anime_unique unique (user_id, anime_id)
);

create index user_anime_user_id_idx  on public.user_anime (user_id);
create index user_anime_anime_id_idx on public.user_anime (anime_id);
create index user_anime_status_idx   on public.user_anime (user_id, watch_status);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.user_anime enable row level security;

create policy "user_anime: users can read own"
  on public.user_anime for select
  to authenticated
  using (auth.uid() = user_id);

create policy "user_anime: users can insert own"
  on public.user_anime for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "user_anime: users can update own"
  on public.user_anime for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "user_anime: users can delete own"
  on public.user_anime for delete
  to authenticated
  using (auth.uid() = user_id);
