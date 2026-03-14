-- =============================================================================
-- Migration: create_profiles
-- Depends on: auth.users (built-in Supabase)
--
-- One profile row per auth user. Created automatically via trigger so the
-- app never has to INSERT manually — sign-up creates both rows atomically.
-- =============================================================================

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null,
  avatar_url  text,
  created_at  timestamptz not null default now(),

  constraint profiles_username_length check (char_length(username) between 2 and 30),
  constraint profiles_username_format check (username ~ '^[a-zA-Z0-9_]+$')
);

-- Unique usernames across the app
create unique index profiles_username_idx on public.profiles (lower(username));

-- Auto-create a profile row whenever a new auth user signs up.
-- username defaults to the portion of their email before '@'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'username',
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.profiles enable row level security;

-- Anyone authenticated can read any profile (needed for friend search)
create policy "profiles: authenticated users can read all"
  on public.profiles for select
  to authenticated
  using (true);

-- Users can only update their own profile
create policy "profiles: users can update own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Insert is handled by the trigger only — no direct user insert allowed
create policy "profiles: no direct insert"
  on public.profiles for insert
  to authenticated
  with check (false);
