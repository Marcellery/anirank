import { supabase } from '@services/supabase';
import type { Database } from '@app-types/index';
import type { UserRanking } from '@app-types/index';

type UserRankingRow = Database['public']['Tables']['user_rankings']['Row'];
type AnimeRow       = Database['public']['Tables']['anime']['Row'];

// ---------------------------------------------------------------------------
// Read rankings
// ---------------------------------------------------------------------------

/**
 * Fetch the full ranked list for a user, sorted by Elo score descending.
 * Returns the joined anime object on each row.
 */
export async function getRankedList(userId: string): Promise<UserRanking[]> {
  const { data, error } = await supabase
    .from('user_rankings')
    .select('*, anime(*)')
    .eq('user_id', userId)
    .order('elo_score', { ascending: false });

  if (error) throw error;

  type Row = UserRankingRow & { anime: AnimeRow };
  return ((data ?? []) as Row[]).map((row, index) => ({
    id:            row.id,
    user_id:       row.user_id,
    anime:         row.anime,
    elo_score:     row.elo_score,
    battle_count:  row.battle_count,
    rank_position: index + 1,   // compute from sort order; DB column updated separately
    updated_at:    row.updated_at,
  }));
}

/**
 * Fetch only the Top 25 entries for a user.
 */
export async function getTop25(userId: string): Promise<UserRanking[]> {
  const full = await getRankedList(userId);
  return full.slice(0, 25);
}

/**
 * Fetch only the Top 10 entries for a user.
 */
export async function getTop10(userId: string): Promise<UserRanking[]> {
  const full = await getRankedList(userId);
  return full.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Write rank_position back to DB
//
// Called after every battle to materialise the integer positions so the
// DB column stays accurate (used by social comparisons in Milestone 6).
// ---------------------------------------------------------------------------

/**
 * Re-compute and persist rank_position for all of a user's rankings.
 * Reads the current Elo order and writes each position as an integer.
 *
 * Milestone 5 will migrate this to a Supabase RPC for efficiency.
 */
export async function recomputeRankPositions(userId: string): Promise<void> {
  const ranked = await getRankedList(userId);

  // Build batch of updates
  const updates = ranked.map((entry, index) =>
    supabase
      .from('user_rankings')
      .update({ rank_position: index + 1 })
      .eq('id', entry.id),
  );

  const results = await Promise.all(updates);
  const firstError = results.find(r => r.error)?.error;
  if (firstError) throw firstError;
}
