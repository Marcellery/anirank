import { StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '@constants/colors';
import { SPACING } from '@constants/spacing';

type Props = ViewProps & { padTop?: boolean };

export function Screen({ padTop = true, style, children, ...rest }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.base,
        padTop && { paddingTop: insets.top },
        { paddingBottom: insets.bottom },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: COLORS.background,
    flex: 1,
    paddingHorizontal: SPACING[4],
  },
});
