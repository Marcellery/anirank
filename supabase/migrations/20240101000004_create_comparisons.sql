-- =============================================================================
-- Migration: create_comparisons
-- Depends on: profiles, anime
--
-- Immutable battle log. One row written per battle result.
-- winner_id and loser_id are anime IDs (not user IDs).
-- Never updated or deleted — it is an append-only audit trail.
-- =============================================================================

create table public.comparisons (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  winner_id   uuid not null references public.anime (id) on delete cascade,
  loser_id    uuid not null references public.anime (id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- A battle must be between two different anime
  constraint comparisons_different_anime check (winner_id <> loser_id)
);

create index comparisons_user_id_idx   on public.comparisons (user_id);
create index comparisons_winner_id_idx on public.comparisons (user_id, winner_id);
create index comparisons_loser_id_idx  on public.comparisons (user_id, loser_id);
create index comparisons_created_idx   on public.comparisons (user_id, created_at desc);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.comparisons enable row level security;

create policy "comparisons: users can read own"
  on public.comparisons for select
  to authenticated
  using (auth.uid() = user_id);

create policy "comparisons: users can insert own"
  on public.comparisons for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Intentionally no UPDATE or DELETE policy — rows are immutable
