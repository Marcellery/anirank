-- =============================================================================
-- Migration: create_share_cards
-- Depends on: profiles
--
-- Records generated share card images (Top 10 / Top 25).
-- image_url points to a Supabase Storage object.
-- Cards are regenerated on demand; old rows can be overwritten or deleted.
-- =============================================================================

create type public.card_type as enum ('top10', 'top25');

create table public.share_cards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  card_type   public.card_type not null,
  image_url   text,
  created_at  timestamptz not null default now()
);

create index share_cards_user_id_idx on public.share_cards (user_id);
create index share_cards_type_idx    on public.share_cards (user_id, card_type);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.share_cards enable row level security;

create policy "share_cards: users can read own"
  on public.share_cards for select
  to authenticated
  using (auth.uid() = user_id);

create policy "share_cards: users can insert own"
  on public.share_cards for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "share_cards: users can update own"
  on public.share_cards for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "share_cards: users can delete own"
  on public.share_cards for delete
  to authenticated
  using (auth.uid() = user_id);
