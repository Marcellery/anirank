import type { AnimeType } from './database';

// Re-export the Database shape and all enum types from the single source of truth.
export type { Database, AnimeType, WatchStatus, FriendStatus, CardType } from './database';

// ---------------------------------------------------------------------------
// Domain types — richer shapes used by feature hooks and UI components.
// These compose the raw DB Row types rather than duplicating columns.
// ---------------------------------------------------------------------------

export type Anime = {
  id:            string;
  title:         string;
  poster:        string | null;
  type:          AnimeType;
  episode_count: number | null;
  release_year:  number | null;
};

// UserRanking joins user_rankings with the nested anime object.
// Returned by ranking queries that do a Supabase select with relation.
export type UserRanking = {
  id:            string;
  user_id:       string;
  anime:         Anime;
  elo_score:     number;
  battle_count:  number;
  rank_position: number | null;
  updated_at:    string;
};

export type BattlePair = {
  left:  UserRanking;
  right: UserRanking;
};

export type BattleResult = {
  winner_id: string;  // anime id
  loser_id:  string;  // anime id
};

// ShareCardType is also exported from database.ts as CardType.
// Alias kept here so feature code can use the more descriptive name.
export type { CardType as ShareCardType } from './database';

