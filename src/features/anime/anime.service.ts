import { supabase } from '@services/supabase';
import type { CatalogType, Database, WatchStatus } from '@app-types/index';

type AnimeRow      = Database['public']['Tables']['anime']['Row'];
type UserAnimeRow  = Database['public']['Tables']['user_anime']['Row'];

// ---------------------------------------------------------------------------
// AniList direct API — used by the onboarding picker
// ---------------------------------------------------------------------------

/** Minimal anime shape returned from AniList and used in the picker UI. */
export interface PickerAnime {
  anilist_id:         number;
  title_english:      string | null;
  title_romaji:       string | null;
  format:             string | null;
  season_year:        number | null;
  episodes:           number | null;
  cover_image_medium: string | null;
  cover_image_large:  string | null;
}

const ANILIST_URL = 'https://graphql.anilist.co';

const ANILIST_SEARCH_QUERY = `
  query ($search: String!, $perPage: Int) {
    Page(perPage: $perPage) {
      media(
        search: $search
        type: ANIME
        format_in: [TV, TV_SHORT, ONA]
        isAdult: false
        sort: SEARCH_MATCH
      ) {
        id
        title { romaji english }
        format
        episodes
        seasonYear
        coverImage { medium large }
      }
    }
  }
`;

const ANILIST_POPULAR_QUERY = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      media(
        type: ANIME
        format_in: [TV, TV_SHORT, ONA]
        isAdult: false
        sort: POPULARITY_DESC
      ) {
        id
        title { romaji english }
        format
        episodes
        seasonYear
        coverImage { medium large }
      }
    }
  }
`;

interface AniListMedia {
  id:          number;
  title:       { romaji: string; english: string | null };
  format:      string | null;
  episodes:    number | null;
  seasonYear:  number | null;
  coverImage:  { medium: string | null; large: string | null } | null;
}

async function fetchAniList(query: string, variables: Record<string, unknown>): Promise<AniListMedia[]> {
  const res = await fetch(ANILIST_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body:    JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`AniList ${res.status}`);

  const json = (await res.json()) as {
    data: { Page: { media: AniListMedia[] } };
    errors?: { message: string }[];
  };

  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data.Page.media ?? [];
}

function mapMedia(m: AniListMedia): PickerAnime {
  return {
    anilist_id:         m.id,
    title_english:      m.title.english ?? null,
    title_romaji:       m.title.romaji  ?? null,
    format:             m.format        ?? null,
    season_year:        m.seasonYear    ?? null,
    episodes:           m.episodes      ?? null,
    cover_image_medium: m.coverImage?.medium ?? null,
    cover_image_large:  m.coverImage?.large  ?? null,
  };
}

/** Search AniList directly. Returns TV/TV_SHORT/ONA series only, no movies. */
export async function searchAniList(query: string, limit = 30): Promise<PickerAnime[]> {
  if (!query.trim()) return [];
  const media = await fetchAniList(ANILIST_SEARCH_QUERY, { search: query.trim(), perPage: limit });
  return media.map(mapMedia);
}

/** Fetch popular anime from AniList. Used as the default browse list. */
export async function listAniListPopular(page = 1, perPage = 50): Promise<PickerAnime[]> {
  const media = await fetchAniList(ANILIST_POPULAR_QUERY, { page, perPage });
  return media.map(mapMedia);
}

/**
 * Upsert a set of AniList entries into the anime catalogue, then add each to
 * the user's watch list.  Uses the upsert_anime_from_anilist RPC (security
 * definer) to bypass the service-role-only RLS restriction on anime INSERT.
 */
export async function addPickerAnimeToList(
  userId:      string,
  items:       PickerAnime[],
  watchStatus: WatchStatus = 'plan_to_watch',
): Promise<void> {
  if (items.length === 0) return;

  // Upsert into anime table and get anilist_id → uuid mapping.
  const payload = items.map((a) => ({
    anilist_id:         a.anilist_id,
    title_english:      a.title_english  ?? '',
    title_romaji:       a.title_romaji   ?? '',
    format:             a.format         ?? '',
    episodes:           a.episodes,
    season_year:        a.season_year,
    cover_image_medium: a.cover_image_medium ?? '',
    cover_image_large:  a.cover_image_large  ?? '',
  }));

  const { data: upserted, error: upsertError } = await supabase
    .rpc('upsert_anime_from_anilist', { data: payload });

  if (upsertError) throw upsertError;

  const idMap = new Map<number, string>(
    (upserted as { anilist_id: number; id: string }[]).map((r) => [r.anilist_id, r.id]),
  );

  // Insert user_anime rows for each upserted entry.
  await Promise.all(
    items.map((item) => {
      const animeId = idMap.get(item.anilist_id);
      if (!animeId) return Promise.resolve();
      return supabase
        .from('user_anime')
        .insert({ user_id: userId, anime_id: animeId, watch_status: watchStatus })
        .select()
        .single();
    }),
  );
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function formatMediaMeta(anime: AnimeRow): string {
  if (anime.format === 'MOVIE') {
    return anime.season_year ? `Movie · ${anime.season_year}` : 'Movie';
  }
  const total = anime.franchise_episode_total ?? anime.episodes ?? anime.episode_count;
  if (total != null && total > 0) {
    return `${total} episode${total === 1 ? '' : 's'}`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Catalogue queries (DB-backed — used outside onboarding)
// ---------------------------------------------------------------------------

const SELECTABLE_TYPES: CatalogType[] = ['series_root', 'standalone_work'];

function normaliseQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[.:\-/\\]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function searchAnime(query: string, limit = 20): Promise<AnimeRow[]> {
  const normalised = normaliseQuery(query);
  if (!normalised) return [];

  const { data, error } = await supabase
    .from('anime')
    .select('*')
    .in('catalog_type', SELECTABLE_TYPES)
    .or('format.is.null,format.neq.MOVIE')
    .or('type.is.null,type.neq.movie')
    .ilike('title_normalized', `%${normalised}%`)
    .order('season_year', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function getAnimeById(id: string): Promise<AnimeRow | null> {
  const { data, error } = await supabase
    .from('anime')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

export async function listAnime(page = 0, pageSize = 50): Promise<AnimeRow[]> {
  const from = page * pageSize;
  const to   = from + pageSize - 1;

  const { data, error } = await supabase
    .from('anime')
    .select('*')
    .in('catalog_type', SELECTABLE_TYPES)
    .or('format.is.null,format.neq.MOVIE')
    .or('type.is.null,type.neq.movie')
    .order('release_year', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// User watch list queries (user_anime table)
// ---------------------------------------------------------------------------

export async function getUserAnimeList(userId: string): Promise<
  (UserAnimeRow & { anime: AnimeRow })[]
> {
  const { data, error } = await supabase
    .from('user_anime')
    .select('*, anime(*)')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as (UserAnimeRow & { anime: AnimeRow })[];
}

export async function addAnimeToList(
  userId:      string,
  animeId:     string,
  watchStatus: WatchStatus = 'plan_to_watch',
): Promise<UserAnimeRow> {
  const { data, error } = await supabase
    .from('user_anime')
    .insert({ user_id: userId, anime_id: animeId, watch_status: watchStatus })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateWatchStatus(
  userId:      string,
  animeId:     string,
  watchStatus: WatchStatus,
): Promise<void> {
  const { error } = await supabase
    .from('user_anime')
    .update({ watch_status: watchStatus })
    .eq('user_id', userId)
    .eq('anime_id', animeId);

  if (error) throw error;
}

export async function removeAnimeFromList(
  userId:  string,
  animeId: string,
): Promise<void> {
  const { error } = await supabase
    .from('user_anime')
    .delete()
    .eq('user_id', userId)
    .eq('anime_id', animeId);

  if (error) throw error;
}
