-- RPC to recompute rank_position for all of a user's rankings in one query.
-- Replaces the N-update loop in ranking.service.ts.
create or replace function public.recompute_rank_positions(p_user_id uuid)
returns void
language sql
security definer
as $$
  update public.user_rankings ur
  set rank_position = ranked.pos
  from (
    select
      id,
      row_number() over (order by elo_score desc) as pos
    from public.user_rankings
    where user_id = p_user_id
  ) ranked
  where ur.id = ranked.id;
$$;
