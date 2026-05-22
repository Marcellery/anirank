import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '@constants/colors';

type Props = {
  uri?: string | null;
  name?: string;
  size?: number;
};

export function Avatar({ uri, name, size = 40 }: Props) {
  const initials = name
    ? name.slice(0, 2).toUpperCase()
    : '?';

  const radius = size / 2;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.base, { width: size, height: size, borderRadius: radius }]}
      />
    );
  }

  return (
    <View style={[styles.base, styles.fallback, { width: size, height: size, borderRadius: radius }]}>
      <Text style={[styles.initials, { fontSize: size * 0.35 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fallback: {
    backgroundColor: COLORS.primary,
  },
  initials: {
    color: COLORS.text,
    fontWeight: '700',
  },
});
