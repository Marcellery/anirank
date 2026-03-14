import { View, Text, StyleSheet } from 'react-native';

/**
 * Placeholder — implemented in Milestone 3 (Onboarding).
 * Will render Supabase email/OAuth login form.
 */
export default function LoginScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Login — Milestone 3</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d14' },
  text: { color: '#ffffff', fontSize: 16 },
});
