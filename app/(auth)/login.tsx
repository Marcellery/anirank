import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  ImageBackground,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, router } from 'expo-router';
import { signIn } from '@services/auth.service';
import { COLORS } from '@constants/colors';

export default function LoginScreen() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const insets = useSafeAreaInsets();

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await signIn({ email: email.trim().toLowerCase(), password });
      // Auth state change listener in _layout.tsx will update the store,
      // and app/index.tsx will redirect to /(tabs)/battles automatically.
    } catch (e: any) {
      setError(e?.message ?? 'Sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <ImageBackground
        source={require('../../assets/backgounds/login-bg.jpg')}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      >
        <LinearGradient
          colors={[
            'rgba(0,0,0,0.65)',
            'rgba(0,0,0,0.45)',
            'rgba(0,0,0,0.85)',
          ]}
          style={StyleSheet.absoluteFill}
        />
      </ImageBackground>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.container,
            {
              paddingTop:    insets.top    + 32,
              paddingBottom: insets.bottom + 32,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.logo}>AniRank</Text>
            <Text style={styles.tagline}>Rank every anime you've ever watched.</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="next"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={COLORS.background} size="small" />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity>
                <Text style={styles.footerLink}>Sign up</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  container: {
    flexGrow:          1,
    justifyContent:    'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems:   'center',
    marginBottom: 48,
  },
  logo: {
    fontSize:      36,
    fontWeight:    '800',
    color:         COLORS.primary,
    letterSpacing: -0.5,
    marginBottom:  8,
  },
  tagline: {
    fontSize:   14,
    color:      COLORS.textSecondary,
    textAlign:  'center',
  },
  form: {
    marginBottom: 32,
  },
  label: {
    fontSize:        13,
    fontWeight:      '600',
    color:           COLORS.textSecondary,
    marginBottom:    6,
    marginTop:       16,
    textTransform:   'uppercase',
    letterSpacing:   0.5,
  },
  input: {
    backgroundColor:  COLORS.surface,
    borderWidth:      1,
    borderColor:      COLORS.border,
    borderRadius:     10,
    paddingHorizontal: 16,
    paddingVertical:  14,
    fontSize:         16,
    color:            COLORS.text,
  },
  errorText: {
    color:     COLORS.error,
    fontSize:  13,
    marginTop: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius:    10,
    paddingVertical: 16,
    alignItems:      'center',
    marginTop:       24,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color:      '#ffffff',
    fontSize:   16,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems:     'center',
  },
  footerText: {
    color:    COLORS.textSecondary,
    fontSize: 14,
  },
  footerLink: {
    color:      COLORS.primary,
    fontSize:   14,
    fontWeight: '600',
  },
});
