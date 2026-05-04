import { useState, useCallback } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { COLORS } from '@constants/colors';
import { SPACING } from '@constants/spacing';
import { Avatar } from '@ui/Avatar';
import { Button } from '@ui/Button';
import { Spinner } from '@ui/Spinner';
import { useAuthStore } from '@stores/index';
import {
  getFriends,
  getIncomingRequests,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
} from '@features/friends/friends.service';
import { searchProfiles } from '@services/profile.service';
import type { Database } from '@app-types/index';

type FriendRow = Database['public']['Tables']['friends']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type Tab = 'friends' | 'requests' | 'search';

const TABS: { key: Tab; label: string }[] = [
  { key: 'friends', label: 'Friends' },
  { key: 'requests', label: 'Requests' },
  { key: 'search', label: 'Find' },
];

function FriendItem({
  profile,
  onRemove,
}: {
  profile: ProfileRow;
  onRemove: () => void;
}) {
  return (
    <View style={styles.friendRow}>
      <Avatar name={profile.username} size={44} />
      <Text style={styles.friendName}>{profile.username}</Text>
      <Pressable onPress={onRemove} style={styles.removeBtn}>
        <Text style={styles.removeBtnText}>Remove</Text>
      </Pressable>
    </View>
  );
}

function RequestItem({
  friend,
  profile,
  onAccept,
  onDecline,
}: {
  friend: FriendRow;
  profile: ProfileRow;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.friendRow}>
      <Avatar name={profile.username} size={44} />
      <Text style={[styles.friendName, { flex: 1 }]}>{profile.username}</Text>
      <View style={styles.requestActions}>
        <Pressable onPress={onAccept} style={styles.acceptBtn}>
          <Text style={styles.acceptBtnText}>Accept</Text>
        </Pressable>
        <Pressable onPress={onDecline} style={styles.declineBtn}>
          <Text style={styles.declineBtnText}>Decline</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function FriendsScreen() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('friends');
  const [searchQuery, setSearchQuery] = useState('');

  const friendsQuery = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => getFriends(user!.id, 'accepted'),
    enabled: !!user?.id && tab === 'friends',
  });

  const requestsQuery = useQuery({
    queryKey: ['friend-requests', user?.id],
    queryFn: () => getIncomingRequests(user!.id),
    enabled: !!user?.id && tab === 'requests',
  });

  const searchQuery_ = useQuery({
    queryKey: ['profile-search', searchQuery],
    queryFn: () => searchProfiles(searchQuery, user!.id),
    enabled: !!user?.id && tab === 'search' && searchQuery.length >= 2,
  });

  const sendRequest = useMutation({
    mutationFn: (addresseeId: string) => sendFriendRequest(user!.id, addresseeId),
    onSuccess: () => Alert.alert('Request sent!'),
    onError: (e: Error) => Alert.alert('Failed', e.message),
  });

  const acceptRequest = useMutation({
    mutationFn: acceptFriendRequest,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['friend-requests', user?.id] });
    },
  });

  const removeOrDecline = useMutation({
    mutationFn: removeFriend,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['friend-requests', user?.id] });
    },
  });

  const renderFriends = useCallback(() => {
    if (friendsQuery.isLoading) return <Spinner fullScreen />;
    const friends = (friendsQuery.data ?? []) as (FriendRow & { other_profile: ProfileRow })[];
    if (friends.length === 0) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No friends yet.</Text>
          <Text style={styles.emptyHint}>Search for users to add.</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={friends}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <FriendItem
            profile={item.other_profile}
            onRemove={() => removeOrDecline.mutate(item.id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={friendsQuery.isRefetching}
            onRefresh={friendsQuery.refetch}
            tintColor={COLORS.primary}
          />
        }
      />
    );
  }, [friendsQuery, removeOrDecline]);

  const renderRequests = useCallback(() => {
    if (requestsQuery.isLoading) return <Spinner fullScreen />;
    const requests = (requestsQuery.data ?? []) as (FriendRow & { other_profile: ProfileRow })[];
    if (requests.length === 0) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No pending requests.</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={requests}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <RequestItem
            friend={item}
            profile={item.other_profile}
            onAccept={() => acceptRequest.mutate(item.id)}
            onDecline={() => removeOrDecline.mutate(item.id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    );
  }, [requestsQuery, acceptRequest, removeOrDecline]);

  const renderSearch = useCallback(() => {
    const results = searchQuery_.data ?? [];
    return (
      <>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by username…"
          placeholderTextColor={COLORS.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {searchQuery.length >= 2 && searchQuery_.isLoading && <Spinner />}
        <FlatList
          data={results}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <View style={styles.friendRow}>
              <Avatar name={item.username} size={44} />
              <Text style={[styles.friendName, { flex: 1 }]}>{item.username}</Text>
              <Button
                label="Add"
                variant="secondary"
                onPress={() => sendRequest.mutate(item.id)}
                loading={sendRequest.isPending}
              />
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            searchQuery.length >= 2 && !searchQuery_.isLoading ? (
              <Text style={styles.noResults}>No users found.</Text>
            ) : null
          }
        />
      </>
    );
  }, [searchQuery, searchQuery_, sendRequest]);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Friends</Text>

      <View style={styles.tabRow}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[styles.tabChip, tab === t.key && styles.tabChipActive]}
          >
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.content}>
        {tab === 'friends' && renderFriends()}
        {tab === 'requests' && renderRequests()}
        {tab === 'search' && renderSearch()}
      </View>
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
  tabRow: {
    flexDirection: 'row',
    gap: SPACING[2],
    paddingHorizontal: SPACING[4],
    marginBottom: SPACING[4],
  },
  tabChip: {
    borderColor: COLORS.border,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[2],
  },
  tabChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  tabLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: COLORS.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING[4],
  },
  friendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING[3],
    paddingVertical: SPACING[3],
  },
  friendName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '600',
  },
  removeBtn: {
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
  },
  removeBtnText: {
    color: COLORS.textMuted,
    fontSize: 13,
  },
  requestActions: {
    flexDirection: 'row',
    gap: SPACING[2],
  },
  acceptBtn: {
    backgroundColor: COLORS.success,
    borderRadius: 8,
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
  },
  acceptBtnText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  declineBtn: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 8,
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
  },
  declineBtnText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  separator: {
    backgroundColor: COLORS.border,
    height: StyleSheet.hairlineWidth,
  },
  searchInput: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    color: COLORS.text,
    fontSize: 15,
    marginBottom: SPACING[3],
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[3],
  },
  noResults: {
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: SPACING[4],
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
});
