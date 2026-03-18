import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useAuthStore } from '@stores/index';
import {
  loadUserRankings,
  recordBattleResult,
  type RankedAnime,
} from '@features/battle/battle.service';
import { COLORS } from '@constants/colors';

// ---------------------------------------------------------------------------
// Matchup selection
// ---------------------------------------------------------------------------

/** Canonical symmetric key for a pair — order-independent. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Pick the next battle pair from the current rankings list.
 *
 * Strategy:
 *  1. Sort by battle_count ascending — least-seen anime get priority.
 *  2. Pick an "anchor" randomly from the bottom 25% (min 1 entry).
 *  3. Sort remaining entries by Elo proximity to the anchor.
 *  4. Choose the first candidate whose pair key isn't in recentPairs.
 *  5. Fall back to the closest-Elo candidate if all pairs are recent.
 *
 * This keeps battles competitive (similar Elo) while ensuring all anime
 * get exposure before any are repeated, and avoids back-to-back rematches.
 */
function pickMatchup(
  rankings:    RankedAnime[],
  recentPairs: string[],
): [RankedAnime, RankedAnime] | null {
  if (rankings.length < 2) return null;

  const byBattles = [...rankings].sort((a, b) => a.battle_count - b.battle_count);
  const poolSize  = Math.max(1, Math.ceil(byBattles.length / 4));
  const anchor    = byBattles[Math.floor(Math.random() * poolSize)];

  const candidates = rankings
    .filter(r => r.anime_id !== anchor.anime_id)
    .sort((a, b) =>
      Math.abs(a.elo_score - anchor.elo_score) -
      Math.abs(b.elo_score - anchor.elo_score),
    );

  // With only 2 anime there's one possible pair — skip recent-pair check.
  if (rankings.length === 2) return [anchor, candidates[0]];

  const recent  = new Set(recentPairs);
  const opponent =
    candidates.find(c => !recent.has(pairKey(anchor.anime_id, c.anime_id))) ??
    candidates[0];

  return [anchor, opponent];
}

// ---------------------------------------------------------------------------
// AnimeCard
// ---------------------------------------------------------------------------

type CardState = 'idle' | 'winner' | 'loser';

function AnimeCard({
  ranking,
  onVote,
  cardState,
  disabled,
}: {
  ranking:   RankedAnime;
  onVote:    (animeId: string) => void;
  cardState: CardState;
  disabled:  boolean;
}) {
  const { anime } = ranking;
  const title    = anime.title_english ?? anime.title_romaji ?? anime.title;
  const year     = anime.season_year  ?? anime.release_year;
  const fmt      = anime.format ?? (anime.type === 'movie' ? 'MOVIE' : 'TV');
  const eps      = anime.franchise_episode_total ?? anime.episodes ?? anime.episode_count;
  const imageUri =
    anime.cover_image_extra_large ??
    anime.cover_image_large       ??
    anime.cover_image_medium      ??
    anime.poster;

  const meta = [fmt, year, eps ? `${eps} eps` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <TouchableOpacity
      style={[
        styles.card,
        cardState === 'winner' && styles.cardWinner,
        cardState === 'loser'  && styles.cardLoser,
      ]}
      onPress={() => onVote(ranking.anime_id)}
      disabled={disabled}
      activeOpacity={0.88}
    >
      {/* Cover art */}
      {imageUri ? (
        <Image
          source={imageUri}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={imageUri}
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.cardNoCover]}>
          <Text style={styles.cardNoCoverText}>
            {title.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}

      {/* Subtle overall tint */}
      <View style={styles.cardOverlay} />

      {/* Elo badge — top right */}
      <View style={styles.eloBadge}>
        <Text style={styles.eloText}>★ {ranking.elo_score}</Text>
      </View>

      {/* Title + meta — bottom panel */}
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.cardMeta}>{meta}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// BattlesTab
// ---------------------------------------------------------------------------

const RECENT_WINDOW = 20; // remember this many pair keys to avoid repeats

export default function BattlesTab() {
  const { user } = useAuthStore();

  const [rankings,     setRankings]    = useState<RankedAnime[]>([]);
  const [matchup,      setMatchup]     = useState<[RankedAnime, RankedAnime] | null>(null);
  const [votingFor,    setVotingFor]   = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading,      setLoading]     = useState(true);
  const [error,        setError]       = useState<string | null>(null);

  // Rolling queue of recent pair keys — avoids back-to-back rematches.
  const recentPairs = useRef<string[]>([]);

  useEffect(() => {
    if (user?.id) load();
  }, [user?.id]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await loadUserRankings(user!.id);
      setRankings(data);
      setMatchup(pickMatchup(data, recentPairs.current));
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load your anime list.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVote(winnerId: string) {
    if (!matchup || !user?.id || votingFor) return;

    const [left, right] = matchup;
    const winner = left.anime_id  === winnerId ? left  : right;
    const loser  = left.anime_id  === winnerId ? right : left;

    // Log this pair as recent before the async work so a fast double-tap can't
    // queue the same pair twice.
    setVotingFor(winnerId);
    recentPairs.current = [
      pairKey(left.anime_id, right.anime_id),
      ...recentPairs.current.slice(0, RECENT_WINDOW - 1),
    ];

    try {
      const { newWinnerElo, newLoserElo } = await recordBattleResult(
        user.id,
        winner.anime_id,
        loser.anime_id,
        { elo_score: winner.elo_score, battle_count: winner.battle_count },
        { elo_score: loser.elo_score,  battle_count: loser.battle_count  },
      );

      // Patch local rankings — no re-fetch needed.
      const updated = rankings.map(r => {
        if (r.anime_id === winner.anime_id)
          return { ...r, elo_score: newWinnerElo, battle_count: r.battle_count + 1 };
        if (r.anime_id === loser.anime_id)
          return { ...r, elo_score: newLoserElo,  battle_count: r.battle_count + 1 };
        return r;
      });

      setRankings(updated);
      setSessionCount(c => c + 1);

      // Hold the result visible briefly, then advance.
      await new Promise<void>(resolve => setTimeout(resolve, 380));

      setVotingFor(null);
      setMatchup(pickMatchup(updated, recentPairs.current));
    } catch (e: any) {
      setVotingFor(null);
      setError(e?.message ?? 'Failed to record battle. Please try again.');
    }
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={load} activeOpacity={0.8}>
          <Text style={styles.retryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (rankings.length < 2) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Not enough anime</Text>
        <Text style={styles.emptyBody}>
          Add at least 2 anime to your list to start battling.
        </Text>
      </View>
    );
  }

  if (!matchup) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const [left, right] = matchup;
  const isVoting      = votingFor !== null;

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Battle</Text>
        {sessionCount > 0 && (
          <Text style={styles.headerStat}>{sessionCount} this session</Text>
        )}
      </View>

      {/* Battle arena — two cards split by VS divider */}
      <View style={styles.arena}>
        <AnimeCard
          ranking={left}
          onVote={handleVote}
          cardState={
            votingFor === left.anime_id  ? 'winner' :
            votingFor !== null           ? 'loser'  : 'idle'
          }
          disabled={isVoting}
        />

        <View style={styles.vsDivider}>
          <View style={styles.vsBadge}>
            <Text style={styles.vsText}>VS</Text>
          </View>
        </View>

        <AnimeCard
          ranking={right}
          onVote={handleVote}
          cardState={
            votingFor === right.anime_id ? 'winner' :
            votingFor !== null           ? 'loser'  : 'idle'
          }
          disabled={isVoting}
        />
      </View>

      {/* Footer hint */}
      <View style={styles.footer}>
        <Text style={styles.hintText}>
          {isVoting ? '' : 'Tap to pick your favorite'}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 32,
  },

  // Header
  header: {
    paddingTop:        Platform.OS === 'ios' ? 56 : 32,
    paddingBottom:     10,
    paddingHorizontal: 20,
    flexDirection:     'row',
    alignItems:        'baseline',
    justifyContent:    'space-between',
  },
  headerTitle: {
    fontSize:     26,
    fontWeight:   '800',
    color:        COLORS.text,
    letterSpacing: -0.5,
  },
  headerStat: {
    fontSize: 13,
    color:    COLORS.textMuted,
  },

  // Arena
  arena: {
    flex:              1,
    paddingHorizontal: 12,
  },

  // Battle card
  card: {
    flex:            1,
    borderRadius:    16,
    overflow:        'hidden',
    backgroundColor: COLORS.surface,
    borderWidth:     2,
    borderColor:     'transparent',
  },
  cardWinner: {
    borderColor: COLORS.primary,
  },
  cardLoser: {
    opacity: 0.38,
  },
  cardNoCover: {
    backgroundColor: COLORS.surfaceElevated,
    justifyContent:  'center',
    alignItems:      'center',
  },
  cardNoCoverText: {
    fontSize:   52,
    color:      COLORS.primary,
    fontWeight: '700',
  },
  cardOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },

  // Elo badge — top right corner of each card
  eloBadge: {
    position:          'absolute',
    top:               12,
    right:             12,
    backgroundColor:   'rgba(0,0,0,0.65)',
    borderRadius:      20,
    paddingHorizontal: 10,
    paddingVertical:   4,
  },
  eloText: {
    color:      COLORS.primaryLight,
    fontSize:   12,
    fontWeight: '700',
  },

  // Title + meta — pinned to bottom of card
  cardInfo: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    backgroundColor: 'rgba(13,13,20,0.92)',
    paddingHorizontal: 14,
    paddingVertical:   12,
  },
  cardTitle: {
    fontSize:    16,
    fontWeight:  '700',
    color:       COLORS.text,
    lineHeight:  21,
    marginBottom: 3,
  },
  cardMeta: {
    fontSize:        12,
    color:           COLORS.textMuted,
    textTransform:   'capitalize',
  },

  // VS divider
  vsDivider: {
    height:         44,
    justifyContent: 'center',
    alignItems:     'center',
  },
  vsBadge: {
    backgroundColor:   COLORS.surfaceElevated,
    borderWidth:       2,
    borderColor:       COLORS.border,
    borderRadius:      20,
    paddingHorizontal: 16,
    paddingVertical:   5,
  },
  vsText: {
    color:         COLORS.textSecondary,
    fontSize:      13,
    fontWeight:    '800',
    letterSpacing: 1,
  },

  // Footer
  footer: {
    paddingVertical: 10,
    paddingBottom:   Platform.OS === 'ios' ? 6 : 10,
    alignItems:      'center',
  },
  hintText: {
    fontSize: 13,
    color:    COLORS.textMuted,
  },

  // Error / empty states
  errorText: {
    color:        COLORS.error,
    fontSize:     15,
    textAlign:    'center',
    marginBottom: 16,
    lineHeight:   22,
  },
  retryButton: {
    backgroundColor:   COLORS.primary,
    borderRadius:      10,
    paddingVertical:   12,
    paddingHorizontal: 24,
  },
  retryButtonText: {
    color:      '#ffffff',
    fontSize:   15,
    fontWeight: '700',
  },
  emptyTitle: {
    fontSize:     20,
    fontWeight:   '700',
    color:        COLORS.text,
    marginBottom: 8,
    textAlign:    'center',
  },
  emptyBody: {
    fontSize:   15,
    color:      COLORS.textSecondary,
    textAlign:  'center',
    lineHeight: 22,
  },
});
