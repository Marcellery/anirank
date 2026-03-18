import { supabase } from '@services/supabase';

const K = 32;

function eloExpected(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export interface BattleResult {
  winnerRating: number;
  loserRating:  number;
}

/**
 * Submit a battle result and apply Elo updates.
 *
 * Steps:
 *   1. Derive loserAnimeId from the two presented anime.
 *   2. Ensure both anime have a rank_state row (upsert with ignoreDuplicates).
 *   3. Fetch both current ratings.
 *   4. Compute new Elo scores (K=32).
 *   5. Insert into user_battles.
 *   6. Update winner and loser rank_state rows.
 */
export async function submitBattle(
  userId:        string,
  animeAId:      number,
  animeBId:      number,
  winnerAnimeId: number,
): Promise<BattleResult> {
  if (winnerAnimeId !== animeAId && winnerAnimeId !== animeBId) {
    throw new Error('winnerAnimeId must be one of the two presented anime');
  }

  const loserAnimeId = winnerAnimeId === animeAId ? animeBId : animeAId;

  // ── 1. Ensure rank_state rows exist for both anime ────────────────────────
  const { error: upsertError } = await supabase
    .from('user_anime_rank_state')
    .upsert(
      [
        { user_id: userId, anime_id: animeAId },
        { user_id: userId, anime_id: animeBId },
      ],
      { onConflict: 'user_id,anime_id', ignoreDuplicates: true },
    );
  if (upsertError) throw upsertError;

  // ── 2. Fetch current ratings ───────────────────────────────────────────────
  const { data: states, error: fetchError } = await supabase
    .from('user_anime_rank_state')
    .select('anime_id, hidden_rating, battle_count, wins, losses')
    .eq('user_id', userId)
    .in('anime_id', [animeAId, animeBId]);
  if (fetchError) throw fetchError;

  const winnerState = states?.find((s) => s.anime_id === winnerAnimeId);
  const loserState  = states?.find((s) => s.anime_id === loserAnimeId);
  if (!winnerState || !loserState) throw new Error('Failed to fetch rank state rows');

  const winnerRating = winnerState.hidden_rating;
  const loserRating  = loserState.hidden_rating;

  // ── 3. Compute Elo ────────────────────────────────────────────────────────
  const expectedWinner = eloExpected(winnerRating, loserRating);
  const expectedLoser  = eloExpected(loserRating, winnerRating);

  const newWinnerRating = winnerRating + K * (1 - expectedWinner);
  const newLoserRating  = loserRating  + K * (0 - expectedLoser);

  const now = new Date().toISOString();

  // ── 4. Insert battle record ───────────────────────────────────────────────
  const { error: battleError } = await supabase
    .from('user_battles')
    .insert({
      user_id:         userId,
      anime_a_id:      animeAId,
      anime_b_id:      animeBId,
      winner_anime_id: winnerAnimeId,
      loser_anime_id:  loserAnimeId,
    });
  if (battleError) throw battleError;

  // ── 5. Update winner ──────────────────────────────────────────────────────
  const { error: winnerError } = await supabase
    .from('user_anime_rank_state')
    .update({
      hidden_rating:   newWinnerRating,
      battle_count:    winnerState.battle_count + 1,
      wins:            winnerState.wins + 1,
      last_battled_at: now,
      updated_at:      now,
    })
    .eq('user_id', userId)
    .eq('anime_id', winnerAnimeId);
  if (winnerError) throw winnerError;

  // ── 6. Update loser ───────────────────────────────────────────────────────
  const { error: loserError } = await supabase
    .from('user_anime_rank_state')
    .update({
      hidden_rating:   newLoserRating,
      battle_count:    loserState.battle_count + 1,
      losses:          loserState.losses + 1,
      last_battled_at: now,
      updated_at:      now,
    })
    .eq('user_id', userId)
    .eq('anime_id', loserAnimeId);
  if (loserError) throw loserError;

  return { winnerRating: newWinnerRating, loserRating: newLoserRating };
}
