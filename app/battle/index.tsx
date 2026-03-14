import { View, Text, StyleSheet } from 'react-native';

/**
 * Placeholder — implemented in Milestone 4 (Battle System).
 * Presented as a fullScreenModal over the tabs.
 * Will render two anime posters with tap/swipe-to-pick interaction.
 */
export default function BattleScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Battle Screen — Milestone 4</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d14' },
  text: { color: '#ffffff', fontSize: 16 },
});
