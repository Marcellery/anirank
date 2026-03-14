/**
 * Elo rating system — as specified in RANKING_ALGORITHM.md.
 *
 * Rules:
 *  - New anime start at the median rating (DEFAULT_RATING).
 *  - K factor is higher for anime with few battles (fast calibration).
 *  - K factor decreases as battle count grows (stability).
 */

export const DEFAULT_RATING = 1500;

/** Returns the K factor for a given battle count. */
export function getKFactor(battleCount: number): number {
  if (battleCount < 10) return 64;   // new — high volatility
  if (battleCount < 30) return 32;   // calibrating
  return 16;                          // established — stable
}

/** Expected score for player A against player B. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Calculate updated ratings after a battle.
 * @param winnerRating  Current Elo of the winner
 * @param loserRating   Current Elo of the loser
 * @param winnerBattles Battle count for the winner (determines K factor)
 * @param loserBattles  Battle count for the loser (determines K factor)
 * @returns { newWinnerRating, newLoserRating }
 */
export function calculateEloUpdate(
  winnerRating: number,
  loserRating: number,
  winnerBattles: number,
  loserBattles: number,
): { newWinnerRating: number; newLoserRating: number } {
  const expectedWinner = expectedScore(winnerRating, loserRating);
  const expectedLoser = expectedScore(loserRating, winnerRating);

  const kWinner = getKFactor(winnerBattles);
  const kLoser = getKFactor(loserBattles);

  const newWinnerRating = Math.round(winnerRating + kWinner * (1 - expectedWinner));
  const newLoserRating = Math.round(loserRating + kLoser * (0 - expectedLoser));

  return { newWinnerRating, newLoserRating };
}
