import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/index';
import { COLORS } from '@constants/colors';

/**
 * Handles the deep-link callback after a user taps the confirmation email.
 *
 * PKCE flow (default):
 *   anirank://auth/confirm?code=XXXX
 *   → exchangeCodeForSession(code) → session established → redirect to /
 *
 * Error case (e.g. expired token):
 *   anirank://auth/confirm?error=...&error_description=...
 *   → show error + back-to-login button
 */
export default function AuthConfirmScreen() {
  const { code, error, error_description } =
    useLocalSearchParams<{ code?: string; error?: string; error_description?: string }>();

  const { checkOnboardingStatus } = useAuthStore();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (error) {
      setErrorMsg(decodeURIComponent(error_description ?? error));
      return;
    }

    if (code) {
      exchangeCode(code);
    }
  }, [code, error]);

  async function exchangeCode(pkceCode: string) {
    try {
      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(pkceCode);
      if (exchangeError) throw exchangeError;

      if (data.session?.user?.id) {
        await checkOnboardingStatus(data.session.user.id);
      }

      // Replace with root index — it will redirect to onboarding or tabs
      router.replace('/');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Confirmation failed. The link may have expired.');
    }
  }

  if (errorMsg) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorTitle}>Confirmation failed</Text>
        <Text style={styles.errorBody}>{errorMsg}</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace('/(auth)/login')}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Back to Sign In</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={COLORS.primary} />
      <Text style={styles.loadingText}>Confirming your account…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 16,
    color: COLORS.textSecondary,
    fontSize: 15,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  errorBody: {
    color: COLORS.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
