import { StyleSheet, View, type ViewProps } from 'react-native';
import { COLORS } from '@constants/colors';
import { SPACING } from '@constants/spacing';

type Props = ViewProps & { elevated?: boolean };

export function Card({ elevated = false, style, children, ...rest }: Props) {
  return (
    <View style={[styles.base, elevated && styles.elevated, style]} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: SPACING[4],
  },
  elevated: {
    backgroundColor: COLORS.surfaceElevated,
  },
});
