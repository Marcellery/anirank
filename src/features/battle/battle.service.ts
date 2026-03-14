import { supabase } from '@services/supabase';
import { calculateEloUpdate } from '@utils/elo';
import type { Database } from '@types/index';
import type { BattlePair, BattleResult } from '@types/index';

type UserRankingRow = Database['public']['Tables']['user_rankings']['Row'];
type AnimeRow       = Database['public']['Tables']['anime']['Row'];

// ---------------------------------------------------------------------------
// Battle pair selection
// ---------------------------------------------------------------------------

/**
 * Pick two anime from the user's ranked list to battle.
 *
 * Strategy: prefer pairs with similar Elo scores so battles are
 * competitive. Fetch a small window around the median and sample randomly.
 *
 * Milestone 4 will refine this with a proper matchmaking algorithm.
 */
export async function getNextBattlePair(userId: string): Promise<BattlePair | null> {
  // Fetch all ranked anime for the user with the joined anime row
  const { data, error } = await supabase
    .from('user_rankings')
    .select('*, anime(*)')
    .eq('user_id', userId)
    .order('elo_score', { ascending: false });

  if (error) throw error;
  if (!data || data.length < 2) return null;

  type RankingWithAnime = UserRankingRow & { anime: AnimeRow };
  const rows = data as RankingWithAnime[];

  // Pick two distinct entries at random from the list
  const shuffled = rows.sort(() => Math.random() - 0.5);
  const [left, right] = shuffled;

  return {
    left:  { ...left,  anime: left.anime },
    right: { ...right, anime: right.anime },
  };
}

// ---------------------------------------------------------------------------
// Record a battle result
//
// Writes the comparison log and updates both Elo scores in a single
// Supabase RPC call to keep the operation atomic.
// ---------------------------------------------------------------------------

/**
 * Submit a battle result.
 *
 * Performs three DB writes:
 *   1. INSERT into comparisons (immutable battle log)
 *   2. UPDATE user_rankings for the winner (new Elo + incremented battle_count)
 *   3. UPDATE user_rankings for the loser  (new Elo + incremented battle_count)
 *
 * Note: These three writes are not wrapped in a transaction at the
 * client level. Milestone 4 will migrate this to a Supabase RPC function
 * that runs inside a single Postgres transaction.
 */
export async function recordBattleResult(
  userId: string,
  result: BattleResult,
  winnerRanking: Pick<UserRankingRow, 'anime_id' | 'elo_score' | 'battle_count'>,
  loserRanking:  Pick<UserRankingRow, 'anime_id' | 'elo_score' | 'battle_count'>,
): Promise<void> {
  const { newWinnerRating, newLoserRating } = calculateEloUpdate(
    winnerRanking.elo_score,
    loserRanking.elo_score,
    winnerRanking.battle_count,
    loserRanking.battle_count,
  );

  // 1. Log the comparison
  const { error: compError } = await supabase
    .from('comparisons')
    .insert({
      user_id:   userId,
      winner_id: result.winner_id,
      loser_id:  result.loser_id,
    });
  if (compError) throw compError;

  // 2. Update winner Elo
  const { error: winError } = await supabase
    .from('user_rankings')
    .update({
      elo_score:    newWinnerRating,
      battle_count: winnerRanking.battle_count + 1,
    })
    .eq('user_id', userId)
    .eq('anime_id', result.winner_id);
  if (winError) throw winError;

  // 3. Update loser Elo
  const { error: loseError } = await supabase
    .from('user_rankings')
    .update({
      elo_score:    newLoserRating,
      battle_count: loserRanking.battle_count + 1,
    })
    .eq('user_id', userId)
    .eq('anime_id', result.loser_id);
  if (loseError) throw loseError;
}

// ---------------------------------------------------------------------------
// Battle history
// ---------------------------------------------------------------------------

/**
 * Fetch the most recent N battles for a user.
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
