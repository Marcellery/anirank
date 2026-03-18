import { supabase } from '@services/supabase';
import { calculateEloUpdate } from '@utils/elo';
import type { Database } from '@app-types/index';

type UserRankingRow = Database['public']['Tables']['user_rankings']['Row'];
type AnimeRow       = Database['public']['Tables']['anime']['Row'];

/**
 * A user_rankings row with the joined anime data.
 * Returned by loadUserRankings and used throughout the battle screen.
 */
export type RankedAnime = UserRankingRow & { anime: AnimeRow };

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Fetch all user_rankings for a user, joined with anime data.
 * Called once on mount; pair selection and state management happen client-side
 * so the screen never needs to re-fetch between battles.
 */
export async function loadUserRankings(userId: string): Promise<RankedAnime[]> {
  const { data, error } = await supabase
    .from('user_rankings')
    .select('*, anime(*)')
    .eq('user_id', userId)
    .order('elo_score', { ascending: false });

  if (error) throw error;
  return (data ?? []) as RankedAnime[];
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

/**
 * Persist a battle result and update Elo scores.
 *
 * Performs three sequential DB writes:
 *   1. INSERT into comparisons   (immutable battle log)
 *   2. UPDATE user_rankings for the winner
 *   3. UPDATE user_rankings for the loser
 *
 * Returns the computed new Elo scores so the caller can update local state
 * without an extra DB round-trip.
 */
export async function recordBattleResult(
  userId:        string,
  winnerId:      string,
  loserId:       string,
  winnerRanking: Pick<UserRankingRow, 'elo_score' | 'battle_count'>,
  loserRanking:  Pick<UserRankingRow, 'elo_score' | 'battle_count'>,
): Promise<{ newWinnerElo: number; newLoserElo: number }> {
  const { newWinnerRating, newLoserRating } = calculateEloUpdate(
    winnerRanking.elo_score,
    loserRanking.elo_score,
    winnerRanking.battle_count,
    loserRanking.battle_count,
  );

  const { error: compError } = await supabase
    .from('comparisons')
    .insert({ user_id: userId, winner_id: winnerId, loser_id: loserId });
  if (compError) throw compError;

  const { error: winError } = await supabase
    .from('user_rankings')
    .update({
      elo_score:    newWinnerRating,
      battle_count: winnerRanking.battle_count + 1,
    })
    .eq('user_id', userId)
    .eq('anime_id', winnerId);
  if (winError) throw winError;

  const { error: loseError } = await supabase
    .from('user_rankings')
    .update({
      elo_score:    newLoserRating,
      battle_count: loserRanking.battle_count + 1,
    })
    .eq('user_id', userId)
    .eq('anime_id', loserId);
  if (loseError) throw loseError;

  return { newWinnerElo: newWinnerRating, newLoserElo: newLoserRating };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Fetch the most recent N battles for a user (for history / stats display).
 */
export async function getRecentBattles(userId: string, limit = 20) {
  const { data, error } = await supabase
    .from('comparisons')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}
