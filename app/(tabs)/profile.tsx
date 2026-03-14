import { View, Text, StyleSheet } from 'react-native';

/**
 * Placeholder — implemented in Milestone 5 (Ranking Screens).
 * Will render user avatar, stats, watch progress, and settings link.
 */
export default function ProfileTab() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Profile — Milestone 5</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d14' },
  text: { color: '#ffffff', fontSize: 16 },
});
