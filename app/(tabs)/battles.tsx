import { View, Text, StyleSheet } from 'react-native';

/**
 * Placeholder — implemented in Milestone 4 (Battle System).
 * Will render the head-to-head battle screen with tap/swipe interaction.
 */
export default function BattlesTab() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Battles — Milestone 4</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d14' },
  text: { color: '#ffffff', fontSize: 16 },
});
