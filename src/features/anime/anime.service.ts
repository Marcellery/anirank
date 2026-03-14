import { supabase } from '@services/supabase';
import type { Database, WatchStatus } from '@types/index';

type AnimeRow      = Database['public']['Tables']['anime']['Row'];
type UserAnimeRow  = Database['public']['Tables']['user_anime']['Row'];

// ---------------------------------------------------------------------------
// Catalogue queries
// ---------------------------------------------------------------------------

/**
 * Full-text search against the anime catalogue.
 * Uses the GIN index on to_tsvector('english', title).
 */
export async function searchAnime(query: string, limit = 20): Promise<AnimeRow[]> {
  const { data, error } = await supabase
    .from('anime')
    .select('*')
    .textSearch('title', query, { type: 'websearch', config: 'english' })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/**
 * Fetch a single anime by id.
 */
export async function getAnimeById(id: string): Promise<AnimeRow | null> {
  const { data, error } = await supabase
    .from('anime')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

/**
 * Fetch a paginated slice of the catalogue, newest first.
 * Used during onboarding to let users browse and add anime.
 */
export async function listAnime(
  page = 0,
  pageSize = 50,
): Promise<AnimeRow[]> {
  const from = page * pageSize;
  const to   = from + pageSize - 1;

  const { data, error } = await supabase
    .from('anime')
    .select('*')
    .order('release_year', { ascending: false })
    .range(from, to);

  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// User watch list queries (user_anime table)
// ---------------------------------------------------------------------------

/**
 * Fetch all user_anime rows for the current user, with the nested anime object.
 */
export async function getUserAnimeList(userId: string): Promise<
  (UserAnimeRow & { anime: AnimeRow })[]
> {
  const { data, error } = await supabase
    .from('user_anime')
    .select('*, anime(*)')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (error) throw error;
  // Supabase returns nested relation as anime: AnimeRow
  return (data ?? []) as (UserAnimeRow & { anime: AnimeRow })[];
}

/**
 * Add an anime to the current user's watch list.
 * The DB trigger will automatically create a user_rankings row at Elo 1500.
 */
export async function addAnimeToList(
  userId: string,
  animeId: string,
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

/**
 * Update the watch status of an existing user_anime row.
 */
export async function updateWatchStatus(
  userId: string,
  animeId: string,
  watchStatus: WatchStatus,
): Promise<void> {
  const { error } = await supabase
    .from('user_anime')
    .update({ watch_status: watchStatus })
    .eq('user_id', userId)
    .eq('anime_id', animeId);

  if (error) throw error;
}

/**
 * Remove an anime from the user's list.
 * Cascades to user_rankings via the FK on delete cascade.
 */
export async function removeAnimeFromList(
  userId: string,
  animeId: string,
): Promise<void> {
  const { error } = await supabase
    .from('user_anime')
    .delete()
    .eq('user_id', userId)
    .eq('anime_id', animeId);

  if (error) throw error;
}
