import { View, Text, StyleSheet } from 'react-native';

/**
 * Placeholder — implemented in Milestone 5 (Ranking Screens).
 * Will render the user's ranked list with Top 25 highlight and share cards.
 */
export default function RankingsTab() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Rankings — Milestone 5</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d14' },
  text: { color: '#ffffff', fontSize: 16 },
});
