import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { COLORS } from '@constants/colors';
import { SPACING } from '@constants/spacing';

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
};

export function Button({ label, onPress, variant = 'primary', loading = false, disabled = false }: Props) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
      ]}
    >
      {loading
        ? <ActivityIndicator color={variant === 'primary' ? COLORS.text : COLORS.primary} size="small" />
        : <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
      }
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: SPACING[6],
  },
  primary: {
    backgroundColor: COLORS.primary,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderColor: COLORS.primary,
    borderWidth: 1.5,
  },
  destructive: {
    backgroundColor: COLORS.error,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryLabel: { color: COLORS.text },
  secondaryLabel: { color: COLORS.primary },
  destructiveLabel: { color: COLORS.text },
  ghostLabel: { color: COLORS.textSecondary },
});
