import { useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { COLORS } from '@constants/colors';
import { SPACING } from '@constants/spacing';
import { Spinner } from '@ui/Spinner';
import { Badge } from '@ui/Badge';
import { useSession } from '@hooks/index';
import { getRankedList } from '@features/ranking/ranking.service';
import type { UserRanking } from '@app-types/index';

type Filter = 'all' | 'top25' | 'top10';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'top25', label: 'Top 25' },
  { key: 'top10', label: 'Top 10' },
];

function RankingRow({ item }: { item: UserRanking }) {
  const cover =
    item.anime.cover_image_large ??
    item.anime.cover_image_medium ??
    item.anime.poster;
  const title = item.anime.title_english ?? item.anime.title_romaji ?? item.anime.title;

  return (
    <View style={styles.row}>
      <Text style={styles.rankNum}>#{item.rank_position ?? '—'}</Text>
      {cover ? (
        <Image source={{ uri: cover }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverFallback]} />
      )}
      <View style={styles.rowInfo}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <View style={styles.meta}>
          <Badge label={`${Math.round(item.elo_score)} ELO`} />
          <Text style={styles.battles}>{item.battle_count} battles</Text>
        </View>
      </View>
    </View>
  );
}

export default function RankingsScreen() {
  const { user } = useSession();
  const [filter, setFilter] = useState<Filter>('all');

  const {
    data: allRankings = [],
    isLoading,
    isRefetching,
    refetch,
    error,
  } = useQuery({
    queryKey: ['rankings', user?.id],
    queryFn: () => getRankedList(user!.id),
    enabled: !!user?.id,
  });

  const displayed =
    filter === 'top10'
      ? allRankings.slice(0, 10)
      : filter === 'top25'
      ? allRankings.slice(0, 25)
      : allRankings;

  if (isLoading) return <Spinner fullScreen />;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>My Rankings</Text>

      <View style={styles.filterRow}>
        {FILTERS.map(f => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
          >
            <Text style={[styles.filterLabel, filter === f.key && styles.filterLabelActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? (
        <Text style={styles.error}>Failed to load rankings.</Text>
      ) : displayed.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No rankings yet.</Text>
          <Text style={styles.emptyHint}>Complete battles to build your list.</Text>
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <RankingRow item={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={COLORS.primary}
            />
          }
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    flex: 1,
    paddingTop: SPACING[12],
  },
  heading: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '700',
    paddingHorizontal: SPACING[4],
    marginBottom: SPACING[4],
  },
  filterRow: {
    flexDirection: 'row',
    gap: SPACING[2],
    paddingHorizontal: SPACING[4],
    marginBottom: SPACING[4],
  },
  filterChip: {
    borderColor: COLORS.border,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[2],
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  filterLabelActive: {
    color: COLORS.text,
  },
  list: {
    paddingHorizontal: SPACING[4],
    paddingBottom: SPACING[8],
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING[3],
    paddingVertical: SPACING[2],
  },
  rankNum: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '700',
    width: 36,
    textAlign: 'right',
  },
  cover: {
    borderRadius: 6,
    height: 64,
    width: 44,
  },
  coverFallback: {
    backgroundColor: COLORS.surfaceElevated,
  },
  rowInfo: {
    flex: 1,
    gap: SPACING[1],
  },
  title: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING[2],
  },
  battles: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  separator: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: SPACING[1],
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    gap: SPACING[2],
  },
  emptyText: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '600',
  },
  emptyHint: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  error: {
    color: COLORS.error,
    padding: SPACING[4],
    textAlign: 'center',
  },
});
