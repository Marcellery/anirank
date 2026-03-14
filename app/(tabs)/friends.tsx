import { View, Text, StyleSheet } from 'react-native';

/**
 * Placeholder — implemented in Milestone 6 (Social Features).
 * Will render friend list, comparison view, and incoming requests.
 */
export default function FriendsTab() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Friends — Milestone 6</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0d0d14' },
  text: { color: '#ffffff', fontSize: 16 },
});
