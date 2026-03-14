/**
 * Hand-maintained Supabase database types.
 * Every column here matches the SQL migrations in supabase/migrations/ exactly.
 *
 * When your Supabase project is live you can replace this file with the
 * auto-generated version:
 *   npx supabase gen types typescript \
 *     --project-id <your-project-ref> \
 *     --schema public \
 *     > src/types/database.ts
 */

// ---------------------------------------------------------------------------
// Enum mirrors — must match the SQL CREATE TYPE statements
// ---------------------------------------------------------------------------

export type AnimeType    = 'series' | 'movie';
export type WatchStatus  = 'watching' | 'completed' | 'plan_to_watch' | 'dropped';
export type FriendStatus = 'pending' | 'accepted' | 'blocked';
export type CardType     = 'top10' | 'top25';

// ---------------------------------------------------------------------------
// Database shape
// ---------------------------------------------------------------------------

export type Database = {
  public: {
    Tables: {

      // -------------------------------------------------------------------
      // profiles
      // id mirrors auth.users.id — created by trigger on sign-up
      // -------------------------------------------------------------------
      profiles: {
        Row: {
          id:          string;       // uuid — FK → auth.users
          username:    string;       // 2–30 chars, alphanumeric + underscore
          avatar_url:  string | null;
          created_at:  string;       // timestamptz
        };
        Insert: {
          id:         string;
          username:   string;
          avatar_url?: string | null;
        };
        Update: {
          username?:   string;
          avatar_url?: string | null;
        };
      };

      // -------------------------------------------------------------------
      // anime
      // Read-only for normal users; populated by service role / seed scripts
      // -------------------------------------------------------------------
      anime: {
        Row: {
          id:            string;          // uuid
          title:         string;
          poster:        string | null;   // URL
          type:          AnimeType;
          episode_count: number | null;
          release_year:  number | null;
          created_at:    string;
        };
        Insert: {
          id?:            string;
          title:          string;
          poster?:        string | null;
          type:           AnimeType;
          episode_count?: number | null;
          release_year?:  number | null;
        };
        Update: {
          title?:         string;
          poster?:        string | null;
          type?:          AnimeType;
          episode_count?: number | null;
          release_year?:  number | null;
        };
      };

      // -------------------------------------------------------------------
      // user_anime
      // One row per (user, anime) — user's personal watch list
      // -------------------------------------------------------------------
      user_anime: {
        Row: {
          id:           string;       // uuid
          user_id:      string;       // uuid → profiles.id
          anime_id:     string;       // uuid → anime.id
          watch_status: WatchStatus;
          added_at:     string;       // timestamptz
        };
        Insert: {
          id?:           string;
          user_id:       string;
          anime_id:      string;
          watch_status?: WatchStatus;
        };
        Update: {
          watch_status?: WatchStatus;
        };
      };

      // -------------------------------------------------------------------
      // user_rankings
      // One row per (user, anime) — Elo score + battle count
      // Created automatically by trigger when user_anime row is inserted
      // -------------------------------------------------------------------
      user_rankings: {
        Row: {
          id:            string;        // uuid
          user_id:       string;        // uuid → profiles.id
          anime_id:      string;        // uuid → anime.id
          elo_score:     number;        // default 1500
          battle_count:  number;        // default 0
          rank_position: number | null; // null until first battle
          updated_at:    string;        // timestamptz — auto-updated by trigger
        };
        Insert: {
          id?:            string;
          user_id:        string;
          anime_id:       string;
          elo_score?:     number;
          battle_count?:  number;
          rank_position?: number | null;
        };
        Update: {
          elo_score?:     number;
          battle_count?:  number;
          rank_position?: number | null;
        };
      };

      // -------------------------------------------------------------------
      // comparisons
      // Append-only battle log — no UPDATE or DELETE for users
      // winner_id / loser_id are anime IDs, not user IDs
      // -------------------------------------------------------------------
      comparisons: {
        Row: {
          id:         string;  // uuid
          user_id:    string;  // uuid → profiles.id
          winner_id:  string;  // uuid → anime.id
          loser_id:   string;  // uuid → anime.id
          created_at: string;  // timestamptz
        };
        Insert: {
          id?:        string;
          user_id:    string;
          winner_id:  string;
          loser_id:   string;
        };
        Update: never;  // immutable
      };

      // -------------------------------------------------------------------
      // friends
      // Canonical pair uniqueness: (canonical_a, canonical_b) where
      // canonical_a = least(requester_id, addressee_id) always.
      // The trigger sets canonical_a/b automatically on insert.
      // -------------------------------------------------------------------
      friends: {
        Row: {
          id:            string;        // uuid
          requester_id:  string;        // uuid → profiles.id
          addressee_id:  string;        // uuid → profiles.id
          status:        FriendStatus;
          created_at:    string;        // timestamptz
          canonical_a:   string;        // uuid — lesser of the pair
          canonical_b:   string;        // uuid — greater of the pair
        };
        Insert: {
          id?:           string;
          requester_id:  string;
          addressee_id:  string;
          status?:       FriendStatus;
          // canonical_a / canonical_b are set by DB trigger — do not supply
        };
        Update: {
          status?: FriendStatus;
        };
      };

      // -------------------------------------------------------------------
      // share_cards
      // Generated Top 10 / Top 25 image cards; image_url → Supabase Storage
      // -------------------------------------------------------------------
      share_cards: {
        Row: {
          id:         string;        // uuid
          user_id:    string;        // uuid → profiles.id
          card_type:  CardType;
          image_url:  string | null; // URL → Supabase Storage
          created_at: string;        // timestamptz
        };
        Insert: {
          id?:        string;
          user_id:    string;
          card_type:  CardType;
          image_url?: string | null;
        };
        Update: {
          image_url?: string | null;
        };
      };

    };
  };
};
