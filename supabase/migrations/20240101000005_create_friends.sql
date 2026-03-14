-- =============================================================================
-- Migration: create_friends
-- Depends on: profiles
--
-- Directed friendship model: requester sends a request to addressee.
-- Status flow: pending → accepted | blocked
--
-- UNIQUENESS STRATEGY — canonical pair:
--   Two stored columns, canonical_a and canonical_b, always hold the lesser
--   and greater UUID respectively (lexicographic order). A plain UNIQUE
--   constraint on (canonical_a, canonical_b) makes it physically impossible
--   for both (A→B) and (B→A) to coexist, regardless of who sent the request.
--
--   Stored columns are preferred over a functional index so the uniqueness is
--   a true table constraint visible in pg_constraint.
-- =============================================================================

create type public.friend_status as enum ('pending', 'accepted', 'blocked');

create table public.friends (
  id            uuid        primary key default gen_random_uuid(),
  requester_id  uuid        not null references public.profiles (id) on delete cascade,
  addressee_id  uuid        not null references public.profiles (id) on delete cascade,
  status        public.friend_status not null default 'pending',
  created_at    timestamptz not null default now(),

  -- Canonical pair columns — always (lesser_uuid, greater_uuid).
  -- Populated automatically by the before-insert trigger below.
  canonical_a   uuid        not null,
  canonical_b   uuid        not null,

  -- Cannot friend yourself
  constraint friends_no_self_friend   check (requester_id <> addressee_id),

  -- One relationship per unordered pair — enforced on stored canonical columns
  constraint friends_canonical_unique unique (canonical_a, canonical_b),

  -- Sanity: canonical ordering is always maintained
  constraint friends_canonical_order  check (canonical_a < canonical_b)
);

-- Trigger: populate canonical_a / canonical_b before every insert
create or replace function public.set_friends_canonical_pair()
returns trigger
language plpgsql
as $$
begin
  new.canonical_a := least(new.requester_id,  new.addressee_id);
  new.canonical_b := greatest(new.requester_id, new.addressee_id);
  return new;
end;
$$;

create trigger friends_set_canonical
  before insert on public.friends
  for each row execute procedure public.set_friends_canonical_pair();

-- Supporting indexes
create index friends_requester_idx on public.friends (requester_id);
create index friends_addressee_idx on public.friends (addressee_id);
create index friends_status_idx    on public.friends (requester_id, status);

-- =============================================================================
-- Row Level Security
-- =============================================================================

alter table public.friends enable row level security;

-- Users can see rows where they are requester or addressee
create policy "friends: users can read own relationships"
  on public.friends for select
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Only the requester can open a new friend request
create policy "friends: users can insert as requester"
  on public.friends for insert
  to authenticated
  with check (auth.uid() = requester_id);

-- Either party can update status (accept or block)
create policy "friends: either party can update status"
  on public.friends for update
  to authenticated
  using  (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Either party can delete (unfriend / withdraw request)
create policy "friends: either party can delete"
  on public.friends for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
