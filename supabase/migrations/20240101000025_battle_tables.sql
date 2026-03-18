-- user_battles: records each head-to-head battle a user completes
create table public.user_battles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  anime_a_id      int  not null references public.anime (id) on delete cascade,
  anime_b_id      int  not null references public.anime (id) on delete cascade,
  winner_anime_id int  not null references public.anime (id) on delete cascade,
  loser_anime_id  int  not null references public.anime (id) on delete cascade,
  created_at      timestamptz not null default now(),

  constraint user_battles_anime_different
    check (anime_a_id <> anime_b_id),

  constraint user_battles_winner_is_presented
    check (winner_anime_id in (anime_a_id, anime_b_id)),

  constraint user_battles_loser_is_presented
    check (loser_anime_id in (anime_a_id, anime_b_id)),

  constraint user_battles_winner_loser_different
    check (winner_anime_id <> loser_anime_id)
);

create index user_battles_user_id_idx  on public.user_battles (user_id);
create index user_battles_anime_a_idx  on public.user_battles (anime_a_id);
create index user_battles_anime_b_idx  on public.user_battles (anime_b_id);

alter table public.user_battles enable row level security;

create policy "users can read own battles"
  on public.user_battles for select
  using (auth.uid() = user_id);

create policy "users can insert own battles"
  on public.user_battles for insert
  with check (auth.uid() = user_id);

-- user_anime_rank_state: per-user rating state for each anime
create table public.user_anime_rank_state (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid             not null references auth.users (id) on delete cascade,
  anime_id        int              not null references public.anime (id) on delete cascade,
  hidden_rating   double precision not null default 1500,
  battle_count    int              not null default 0,
  wins            int              not null default 0,
  losses          int              not null default 0,
  last_battled_at timestamptz,
  created_at      timestamptz      not null default now(),
  updated_at      timestamptz      not null default now(),

  constraint user_anime_rank_state_user_anime_unique unique (user_id, anime_id)
);

create index user_anime_rank_state_user_id_idx      on public.user_anime_rank_state (user_id);
create index user_anime_rank_state_anime_id_idx     on public.user_anime_rank_state (anime_id);
create index user_anime_rank_state_user_rating_idx  on public.user_anime_rank_state (user_id, hidden_rating desc);

alter table public.user_anime_rank_state enable row level security;

create policy "users can read own rank state"
  on public.user_anime_rank_state for select
  using (auth.uid() = user_id);

create policy "users can insert own rank state"
  on public.user_anime_rank_state for insert
  with check (auth.uid() = user_id);

create policy "users can update own rank state"
  on public.user_anime_rank_state for update
  using     (auth.uid() = user_id)
  with check (auth.uid() = user_id);
