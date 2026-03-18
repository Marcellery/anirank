/**
 * Hand-maintained Supabase database types.
 * Mirrors the SQL schema exactly.
 */

export type AnimeType = 'series' | 'movie'
export type WatchStatus = 'watching' | 'completed' | 'plan_to_watch' | 'dropped'
export type FriendStatus = 'pending' | 'accepted' | 'blocked'
export type CardType = 'top10' | 'top25'
export type CatalogType = 'series_root' | 'standalone_work' | 'franchise_child'

export type Database = {
  public: {
    Tables: {

      profiles: {
        Row: {
          id: string
          username: string
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id: string
          username: string
          avatar_url?: string | null
        }
        Update: {
          username?: string
          avatar_url?: string | null
        }
        Relationships: []
      }

      anime: {
        Row: {
          id: string
          title: string
          poster: string | null
          type: AnimeType
          episode_count: number | null
          release_year: number | null
          created_at: string

          anilist_id: number | null
          title_romaji: string | null
          title_english: string | null
          title_native: string | null

          cover_image_extra_large: string | null
          cover_image_large: string | null
          cover_image_medium: string | null

          description: string | null
          format: string | null
          status: string | null

          season_year: number | null
          episodes: number | null

          is_canonical: boolean
          franchise_episode_total: number | null
          franchise_root_id: string | null
          title_normalized: string | null
          prequel_anilist_id: number | null

          catalog_type: CatalogType

          synced_at: string | null
          next_airing_episode: number | null
          next_airing_at: string | null
        }

        Insert: {
          id?: string
          title: string
          poster?: string | null
          type: AnimeType
          episode_count?: number | null
          release_year?: number | null

          anilist_id?: number | null
          title_romaji?: string | null
          title_english?: string | null
          title_native?: string | null

          cover_image_extra_large?: string | null
          cover_image_large?: string | null
          cover_image_medium?: string | null

          description?: string | null
          format?: string | null
          status?: string | null

          season_year?: number | null
          episodes?: number | null

          is_canonical?: boolean
          franchise_episode_total?: number | null
          franchise_root_id?: string | null
          title_normalized?: string | null
          prequel_anilist_id?: number | null

          catalog_type?: CatalogType

          synced_at?: string | null
          next_airing_episode?: number | null
          next_airing_at?: string | null
        }

        Update: {
          title?: string
          poster?: string | null
          type?: AnimeType
          episode_count?: number | null
          release_year?: number | null

          anilist_id?: number | null
          title_romaji?: string | null
          title_english?: string | null
          title_native?: string | null

          cover_image_extra_large?: string | null
          cover_image_large?: string | null
          cover_image_medium?: string | null

          description?: string | null
          format?: string | null
          status?: string | null

          season_year?: number | null
          episodes?: number | null

          is_canonical?: boolean
          franchise_episode_total?: number | null
          franchise_root_id?: string | null
          title_normalized?: string | null
          prequel_anilist_id?: number | null

          catalog_type?: CatalogType

          synced_at?: string | null
          next_airing_episode?: number | null
          next_airing_at?: string | null
        }

        Relationships: []
      }

      user_anime: {
        Row: {
          id: string
          user_id: string
          anime_id: string
          watch_status: WatchStatus
          added_at: string
        }

        Insert: {
          id?: string
          user_id: string
          anime_id: string
          watch_status?: WatchStatus
        }

        Update: {
          watch_status?: WatchStatus
        }

        Relationships: []
      }

      user_battles: {
        Row: {
          id: string
          user_id: string
          anime_a_id: string
          anime_b_id: string
          winner_anime_id: string
          loser_anime_id: string
          created_at: string
        }

        Insert: {
          id?: string
          user_id: string
          anime_a_id: string
          anime_b_id: string
          winner_anime_id: string
          loser_anime_id: string
        }

        Update: Record<string, never>

        Relationships: []
      }

      user_anime_rank_state: {
        Row: {
          id: string
          user_id: string
          anime_id: string
          hidden_rating: number
          battle_count: number
          wins: number
          losses: number
          last_battled_at: string | null
          created_at: string
          updated_at: string
        }

        Insert: {
          id?: string
          user_id: string
          anime_id: string
          hidden_rating?: number
          battle_count?: number
          wins?: number
          losses?: number
          last_battled_at?: string | null
        }

        Update: {
          hidden_rating?: number
          battle_count?: number
          wins?: number
          losses?: number
          last_battled_at?: string | null
          updated_at?: string
        }

        Relationships: []
      }

      friends: {
        Row: {
          id: string
          requester_id: string
          addressee_id: string
          status: FriendStatus
          created_at: string
          canonical_a: string
          canonical_b: string
        }

        Insert: {
          id?: string
          requester_id: string
          addressee_id: string
          status?: FriendStatus
        }

        Update: {
          status?: FriendStatus
        }

        Relationships: []
      }

      comparisons: {
        Row: {
          id: string
          user_id: string
          winner_id: string
          loser_id: string
          created_at: string
        }

        Insert: {
          id?: string
          user_id: string
          winner_id: string
          loser_id: string
        }

        Update: Record<string, never>

        Relationships: []
      }

      share_cards: {
        Row: {
          id: string
          user_id: string
          card_type: CardType
          image_url: string | null
          created_at: string
        }

        Insert: {
          id?: string
          user_id: string
          card_type: CardType
          image_url?: string | null
        }

        Update: {
          image_url?: string | null
        }

        Relationships: []
      }

    }

    Views: {}

    Functions: {}

    Enums: {
      anime_type: AnimeType
      watch_status: WatchStatus
      friend_status: FriendStatus
      card_type: CardType
    }

    CompositeTypes: Record<string, never>
  }
}
