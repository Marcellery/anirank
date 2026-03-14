import { View, Text, StyleSheet } from 'react-native';

/**
 * Placeholder — implemented in Milestone 3 (Onboarding).
 * Will render the first-run flow: seed anime selection, username setup.
 * Lives outside (tabs) so there is no tab bar visible during onboarding.
 */
export default function OnboardingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Onboarding — Milestone 3</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d14' },
  text: { color: '#ffffff', fontSize: 16 },
});
