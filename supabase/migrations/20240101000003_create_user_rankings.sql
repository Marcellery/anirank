-- =============================================================================
-- Migration: create_user_rankings
-- Depends on: profiles, anime
--
-- Stores each user's Elo score and battle count per anime.
-- A row is created here when an anime is added to user_anime.
-- rank_position is a materialised integer updated after every battle.
-- DEFAULT_ELO matches the TypeScript constant in src/utils/elo.ts (1500).
-- =============================================================================

create table public.user_rankings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  anime_id       uuid not null references public.anime (id) on delete cascade,
  elo_score      integer not null default 1500,
  battle_count   integer not null default 0,
  rank_position  integer,                         -- null until first battle
  updated_at     timestamptz not null default now(),

  constraint user_rankings_unique      unique (user_id, anime_id),
  constraint user_rankings_elo_min     check (elo_score >= 0),
  constraint user_rankings_battles_min check (battle_count >= 0),
  constraint user_rankings_rank_min    check (rank_position is null or rank_position >= 1)
);

create index user_rankings_user_id_idx       on public.user_rankings (user_id);
create index user_rankings_elo_score_idx     on public.user_rankings (user_id, elo_score desc);
create index user_rankings_rank_position_idx on public.user_rankings (user_id, rank_position);

-- Keep updated_at current automatically
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_rankings_updated_at
  before update on public.user_rankings
  for each row execute procedure public.set_updated_at();

-- Auto-create a user_rankings row whenever a user_anime row is inserted,
-- so every anime on the user's list immediately has an Elo score of 1500.
create or replace function public.handle_new_user_anime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_rankings (user_id, anime_id)
  values (new.user_id, new.anime_id)
  on conflict (user_id, anime_id) do nothing;
  return new;
end;
$$;

create trigger on_user_anime_inserted
  after insert on public.user_anime
  for each row execute procedure public.handle_new_user_anime();

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.user_rankings enable row level security;

-- Users can only read their own rankings.
-- Public summaries and friend comparisons will be added in Milestone 6
-- via a dedicated read-only view with explicit sharing controls.
create policy "user_rankings: users can read own"
  on public.user_rankings for select
  to authenticated
  using (auth.uid() = user_id);

create policy "user_rankings: users can update own"
  on public.user_rankings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Insert via trigger only; allow direct insert for the trigger's security definer context
create policy "user_rankings: users can insert own"
  on public.user_rankings for insert
  to authenticated
  with check (auth.uid() = user_id);
