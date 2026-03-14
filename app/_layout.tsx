import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StyleSheet } from 'react-native';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/index';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 min
    },
  },
});

/**
 * Root layout — wraps the entire app with providers and mounts the
 * Supabase auth listener exactly once.
 *
 * Boot sequence:
 *  1. bootstrapSession() restores any persisted session from SecureStore.
 *  2. onAuthStateChange fires for every subsequent sign-in / sign-out.
 *  3. app/index.tsx reads isLoading + isAuthenticated and redirects.
 */
function AuthBootstrap() {
  const { bootstrapSession, setSession } = useAuthStore();

  useEffect(() => {
    // Restore persisted session on cold start
    bootstrapSession();

    // Keep store in sync with every auth event (sign-in, sign-out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <AuthBootstrap />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen
            name="battle/index"
            options={{ presentation: 'fullScreenModal' }}
          />
        </Stack>
        <StatusBar style="light" />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
