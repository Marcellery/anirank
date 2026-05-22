import { StyleSheet, Text, View } from 'react-native';
import { COLORS } from '@constants/colors';
import { SPACING } from '@constants/spacing';

type Props = {
  label: string | number;
  color?: string;
};

export function Badge({ label, color = COLORS.primary }: Props) {
  return (
    <View style={[styles.container, { backgroundColor: `${color}22` }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: SPACING[2],
    paddingVertical: 2,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
});
