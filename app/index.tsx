import { Redirect } from 'expo-router';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useSession } from '@hooks/index';
import { COLORS } from '@constants/colors';

/**
 * Entry point — reads live session state and redirects immediately.
 *
 * Three possible destinations:
 *   (auth)/login       — no session
 *   /onboarding        — session exists but onboarding not yet completed
 *   (tabs)/battles     — fully authenticated + onboarded
 *
 * Shows a blank loading screen while bootstrapSession() is in flight
 * so the user never sees a redirect flash.
 */
export default function Index() {
  const { isLoading, isAuthenticated, hasCompletedOnboarding } = useSession();

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  if (!hasCompletedOnboarding) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)/battles" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
});
