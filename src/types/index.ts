import type { AnimeType } from './database';

// Re-export the Database shape and all enum types from the single source of truth.
export type { Database, AnimeType, WatchStatus, FriendStatus, CardType, CatalogType } from './database';

// ---------------------------------------------------------------------------
// Domain types — richer shapes used by feature hooks and UI components.
// These compose the raw DB Row types rather than duplicating columns.
// ---------------------------------------------------------------------------

export type Anime = {
  id:                 string;
  title:              string;        // display title (english ?? romaji)
  poster:             string | null; // legacy poster URL
  type:               AnimeType;
  episode_count:      number | null; // legacy
  release_year:       number | null; // legacy
  // Milestone 3.5: AniList metadata
  anilist_id:         number | null;
  title_romaji:       string | null;
  title_english:      string | null;
  title_native:       string | null;
  cover_image_extra_large: string | null;
  cover_image_large:       string | null;
  cover_image_medium:      string | null;
  description:        string | null;
  format:             string | null;
  status:             string | null;
  season_year:        number | null;
  episodes:           number | null;
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

