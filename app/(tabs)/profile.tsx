import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { useAuthStore } from '@stores/index';
import { supabase } from '@services/supabase';
import { COLORS } from '@constants/colors';

/**
 * Placeholder — implemented in Milestone 5 (Ranking Screens).
 * Will render user avatar, stats, watch progress, and settings link.
 */
export default function ProfileTab() {
  const { user, setHasCompletedOnboarding } = useAuthStore();
  const [resetting, setResetting] = useState(false);

  async function handleDevReset() {
    if (!user?.id) return;

    Alert.alert(
      'Reset App State',
      'Delete all your anime and return to onboarding?',
      [
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
      ],
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Profile — Milestone 5</Text>

      {__DEV__ && (
        <TouchableOpacity
          style={styles.devButton}
          onPress={handleDevReset}
          disabled={resetting}
          activeOpacity={0.75}
        >
          {resetting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.devButtonText}>DEV: Reset App State</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d14' },
  text: { color: '#ffffff', fontSize: 16, marginBottom: 32 },
  devButton: {
    backgroundColor: COLORS.error,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
    minWidth: 200,
  },
  devButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
