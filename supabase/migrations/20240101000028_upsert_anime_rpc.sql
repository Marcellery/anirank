-- =============================================================================
-- Migration 028 — upsert_anime_from_anilist RPC
--
-- Allows the app client (authenticated, anon key) to upsert AniList entries
-- into the anime catalogue.  Runs SECURITY DEFINER to bypass the RLS policy
-- that restricts INSERT/UPDATE to service role only.
--
-- Input:  jsonb array of anime objects from AniList API.
-- Output: table of (anilist_id integer, id uuid) — caller uses this to
--         link user_anime rows to the correct anime UUIDs.
-- =============================================================================

create or replace function public.upsert_anime_from_anilist(data jsonb)
returns table(anilist_id integer, id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.anime (
    anilist_id,
    title,
    title_english,
    title_romaji,
    format,
    type,
    episodes,
    episode_count,
    season_year,
    release_year,
    cover_image_medium,
    cover_image_large,
    synced_at
  )
  select
    (entry->>'anilist_id')::integer,
    coalesce(
      nullif(entry->>'title_english', ''),
      nullif(entry->>'title_romaji',  ''),
      'Unknown'
    ),
    nullif(entry->>'title_english', ''),
    nullif(entry->>'title_romaji',  ''),
    entry->>'format',
    case when entry->>'format' = 'MOVIE' then 'movie'::public.anime_type
         else 'series'::public.anime_type end,
    (entry->>'episodes')::integer,
    (entry->>'episodes')::integer,
    (entry->>'season_year')::integer,
    (entry->>'season_year')::integer,
    nullif(entry->>'cover_image_medium', ''),
    nullif(entry->>'cover_image_large',  ''),
    now()
  from jsonb_array_elements(data) as entry
  on conflict (anilist_id) do update set
    title              = excluded.title,
    title_english      = excluded.title_english,
    title_romaji       = excluded.title_romaji,
    format             = excluded.format,
    episodes           = coalesce(excluded.episodes, public.anime.episodes),
    episode_count      = coalesce(excluded.episode_count, public.anime.episode_count),
    season_year        = coalesce(excluded.season_year, public.anime.season_year),
    cover_image_medium = coalesce(excluded.cover_image_medium, public.anime.cover_image_medium),
    cover_image_large  = coalesce(excluded.cover_image_large,  public.anime.cover_image_large),
    synced_at          = excluded.synced_at
  returning public.anime.anilist_id, public.anime.id;
end;
$$;

comment on function public.upsert_anime_from_anilist(jsonb) is
  'Upserts AniList media entries into the anime catalogue and returns anilist_id→id
   pairs so the caller can link user_anime rows to the correct UUIDs.
   SECURITY DEFINER — bypasses the service-role-only RLS restriction on anime INSERT.
   Called by the app when a user selects an anime not yet in the catalogue.';

-- Grant execute to authenticated users (anon key sessions after login)
grant execute on function public.upsert_anime_from_anilist(jsonb) to authenticated;
