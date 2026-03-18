import { supabase } from '@services/supabase';
import type { CatalogType, Database, WatchStatus } from '@app-types/index';

type AnimeRow      = Database['public']['Tables']['anime']['Row'];
type UserAnimeRow  = Database['public']['Tables']['user_anime']['Row'];

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Returns the media-type + year string for display below an anime title.
 *
 * Rules:
 *   Movies    → "Movie · YYYY"   (never show episode count)
 *   TV series → "N episodes"     (from franchise_episode_total when available)
 *   Unknown   → ""
 *
 * Usage:
 *   const meta = formatMediaMeta(anime);
 *   // "Movie · 2021"  or  "26 episodes"  or  ""
 */
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
// Catalogue queries
// ---------------------------------------------------------------------------

// Selectable catalog types — used by all query filters.
// franchise_child entries are always hidden from the app.
const SELECTABLE_TYPES: CatalogType[] = ['series_root', 'standalone_work'];

/**
 * Normalise a search query to match the spaced form stored in title_normalized.
 *   lowercase → replace punctuation separators (.:/-\) with spaces
 *   → strip remaining non-alphanumeric chars → collapse whitespace.
 *
 * The DB stores both spaced ("oshi no ko") and spaceless ("oshinoko") forms in
 * title_normalized (migration 019).  This function produces the spaced form,
 * which matches the spaced part.  Spaceless queries ("oshinoko", "drstone")
 * pass through unchanged and match the spaceless suffix directly.
 *
 * Must mirror normalize_title() in migration 20240101000019_catalog_architecture.sql.
 */
function normaliseQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/[.:\-/\\]/g, ' ')  // word-separating punctuation → space
    .replace(/[^a-z0-9 ]/g, '') // apostrophes, commas, etc. → removed
    .replace(/\s+/g, ' ')       // collapse spaces
    .trim();
}

/**
 * Partial, punctuation-insensitive search against the anime catalogue.
 * Searches the pre-normalised title_normalized column so that
 * "dr stone" matches "Dr. STONE", "kaguya sama" matches "Kaguya-sama", etc.
 */
export async function searchAnime(query: string, limit = 20): Promise<AnimeRow[]> {
  const normalised = normaliseQuery(query);
  if (!normalised) return [];

  const { data, error } = await supabase
    .from('anime')
    .select('*')
    .in('catalog_type', SELECTABLE_TYPES)
    .ilike('title_normalized', `%${normalised}%`)
    .order('season_year', { ascending: false })
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
    .in('catalog_type', SELECTABLE_TYPES)
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
