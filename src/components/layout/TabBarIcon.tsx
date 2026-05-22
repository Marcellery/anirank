import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@constants/colors';

type Props = {
  name: React.ComponentProps<typeof Ionicons>['name'];
  focused: boolean;
};

export function TabBarIcon({ name, focused }: Props) {
  return (
    <Ionicons
      name={name}
      size={24}
      color={focused ? COLORS.primary : COLORS.textMuted}
    />
  );
}
