import { useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { COLORS } from '@constants/colors';
import { SPACING } from '@constants/spacing';
import { Avatar } from '@ui/Avatar';
import { Button } from '@ui/Button';
import { Spinner } from '@ui/Spinner';
import { useAuthStore } from '@stores/index';
import { supabase } from '@services/supabase';
import { getProfile, updateProfile } from '@services/profile.service';
import { getRankedList } from '@features/ranking/ranking.service';

export default function ProfileScreen() {
  const { user, signOut, setHasCompletedOnboarding } = useAuthStore();
  const queryClient = useQueryClient();
  const [editingUsername, setEditingUsername] = useState(false);
  const [draft, setDraft] = useState('');
  const [resetting, setResetting] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => getProfile(user!.id),
    enabled: !!user?.id,
  });

  const { data: rankings = [] } = useQuery({
    queryKey: ['rankings', user?.id],
    queryFn: () => getRankedList(user!.id),
    enabled: !!user?.id,
  });

  const updateMutation = useMutation({
    mutationFn: (username: string) => updateProfile(user!.id, { username }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', user?.id] });
      setEditingUsername(false);
    },
    onError: (e: Error) => Alert.alert('Update failed', e.message),
  });

  async function handleDevReset() {
    if (!user?.id) return;
    Alert.alert('Reset App State', 'Delete all your anime and return to onboarding?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          setResetting(true);
          try {
            const { error } = await supabase
              .from('user_anime')
              .delete()
              .eq('user_id', user.id);
            if (error) throw error;
            setHasCompletedOnboarding(false);
            router.replace('/onboarding');
          } catch (e: any) {
            Alert.alert('Reset failed', e?.message ?? 'Unknown error');
          } finally {
            setResetting(false);
          }
        },
      },
    ]);
  }

  if (profileLoading) return <Spinner fullScreen />;

  const totalBattles = rankings.reduce((sum, r) => sum + r.battle_count, 0);
  const topAnime = rankings[0]?.anime;
  const topTitle = topAnime
    ? (topAnime.title_english ?? topAnime.title_romaji ?? topAnime.title)
    : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Avatar name={profile?.username} size={72} />

        {editingUsername ? (
          <View style={styles.editRow}>
            <TextInput
              style={styles.usernameInput}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={() => draft.trim() && updateMutation.mutate(draft.trim())}
            />
            <TouchableOpacity onPress={() => setEditingUsername(false)}>
              <Text style={styles.cancelEdit}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => { setDraft(profile?.username ?? ''); setEditingUsername(true); }}
          >
            <Text style={styles.username}>{profile?.username ?? '—'}</Text>
            <Text style={styles.editHint}>Tap to edit</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{rankings.length}</Text>
          <Text style={styles.statLabel}>Anime ranked</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{totalBattles}</Text>
          <Text style={styles.statLabel}>Battles fought</Text>
        </View>
      </View>

      {topTitle && (
        <View style={styles.topAnime}>
          <Text style={styles.topAnimeLabel}>#1 ranked</Text>
          <Text style={styles.topAnimeTitle} numberOfLines={1}>{topTitle}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <Button label="Sign out" variant="secondary" onPress={signOut} />

        {__DEV__ && (
          <TouchableOpacity
            style={styles.devButton}
            onPress={handleDevReset}
            disabled={resetting}
            activeOpacity={0.75}
          >
            {resetting
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.devButtonText}>DEV: Reset App State</Text>
            }
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    flex: 1,
    paddingTop: SPACING[12],
    paddingHorizontal: SPACING[4],
  },
  header: {
    alignItems: 'center',
    gap: SPACING[3],
    marginBottom: SPACING[8],
  },
  username: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  editHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
  },
  editRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SPACING[3],
  },
  usernameInput: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.primary,
    borderRadius: 8,
    borderWidth: 1.5,
    color: COLORS.text,
    fontSize: 16,
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
    minWidth: 160,
  },
  cancelEdit: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  statsRow: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: SPACING[4],
    paddingVertical: SPACING[4],
  },
  stat: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  statValue: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '700',
  },
  statLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  statDivider: {
    backgroundColor: COLORS.border,
    width: 1,
  },
  topAnime: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: SPACING[8],
    padding: SPACING[4],
    gap: 4,
  },
  topAnimeLabel: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  topAnimeTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  actions: {
    gap: SPACING[3],
  },
  devButton: {
    alignItems: 'center',
    backgroundColor: COLORS.error,
    borderRadius: 10,
    minWidth: 200,
    paddingHorizontal: SPACING[6],
    paddingVertical: 14,
  },
  devButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
