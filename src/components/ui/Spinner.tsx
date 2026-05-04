import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { COLORS } from '@constants/colors';

type Props = { size?: 'small' | 'large'; fullScreen?: boolean };

export function Spinner({ size = 'large', fullScreen = false }: Props) {
  if (fullScreen) {
    return (
      <View style={styles.fullScreen}>
        <ActivityIndicator size={size} color={COLORS.primary} />
      </View>
    );
  }
  return <ActivityIndicator size={size} color={COLORS.primary} />;
}

const styles = StyleSheet.create({
  fullScreen: {
    alignItems: 'center',
    backgroundColor: COLORS.background,
    flex: 1,
    justifyContent: 'center',
  },
});
