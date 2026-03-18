-- =============================================================================
-- Migration: create_missing_tables
-- Safe to run on a fresh instance OR an existing one — all statements are
-- idempotent (IF NOT EXISTS / CREATE OR REPLACE / DO … EXCEPTION blocks).
--
-- Creates user_rankings and comparisons, which the battle engine requires.
-- If these tables already exist (from running migration 000003/000004 manually)
-- this migration is a no-op.
-- =============================================================================

-- =============================================================================
-- user_rankings
-- Stores each user's Elo score and battle count per anime.
-- A row is auto-created here when an anime is added to user_anime.
-- =============================================================================

create table if not exists public.user_rankings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  anime_id       uuid not null references public.anime (id) on delete cascade,
  elo_score      integer not null default 1500,
  battle_count   integer not null default 0,
  rank_position  integer,
  updated_at     timestamptz not null default now(),

  constraint user_rankings_unique      unique (user_id, anime_id),
  constraint user_rankings_elo_min     check (elo_score >= 0),
  constraint user_rankings_battles_min check (battle_count >= 0),
  constraint user_rankings_rank_min    check (rank_position is null or rank_position >= 1)
);

create index if not exists user_rankings_user_id_idx
  on public.user_rankings (user_id);

create index if not exists user_rankings_elo_score_idx
  on public.user_rankings (user_id, elo_score desc);

create index if not exists user_rankings_rank_position_idx
  on public.user_rankings (user_id, rank_position);

-- Keep updated_at current automatically (CREATE OR REPLACE is idempotent)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_rankings_updated_at on public.user_rankings;
create trigger user_rankings_updated_at
  before update on public.user_rankings
  for each row execute procedure public.set_updated_at();

-- Auto-create a user_rankings row whenever a user_anime row is inserted
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

drop trigger if exists on_user_anime_inserted on public.user_anime;
create trigger on_user_anime_inserted
  after insert on public.user_anime
  for each row execute procedure public.handle_new_user_anime();

-- RLS
alter table public.user_rankings enable row level security;

do $$ begin
  create policy "user_rankings: users can read own"
    on public.user_rankings for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "user_rankings: users can update own"
    on public.user_rankings for update
    to authenticated
    using  (auth.uid() = user_id)
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "user_rankings: users can insert own"
    on public.user_rankings for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- comparisons
-- Append-only battle log. One row per battle result. Never updated/deleted.
-- winner_id / loser_id are anime IDs, not user IDs.
-- =============================================================================

create table if not exists public.comparisons (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  winner_id   uuid not null references public.anime (id) on delete cascade,
  loser_id    uuid not null references public.anime (id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint comparisons_different_anime check (winner_id <> loser_id)
);

create index if not exists comparisons_user_id_idx
  on public.comparisons (user_id);

create index if not exists comparisons_winner_id_idx
  on public.comparisons (user_id, winner_id);

create index if not exists comparisons_loser_id_idx
  on public.comparisons (user_id, loser_id);

create index if not exists comparisons_created_idx
  on public.comparisons (user_id, created_at desc);

alter table public.comparisons enable row level security;

do $$ begin
  create policy "comparisons: users can read own"
    on public.comparisons for select
    to authenticated
    using (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "comparisons: users can insert own"
    on public.comparisons for insert
    to authenticated
    with check (auth.uid() = user_id);
exception when duplicate_object then null;
end $$;

-- Intentionally no UPDATE or DELETE policy — rows are immutable
