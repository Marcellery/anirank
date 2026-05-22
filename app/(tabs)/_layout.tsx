import { Tabs } from 'expo-router';
import { COLORS } from '@constants/colors';
import { TabBarIcon } from '@layout/TabBarIcon';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.surface,
          borderTopColor: COLORS.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.textMuted,
      }}
    >
      <Tabs.Screen
        name="battles"
        options={{
          title: 'Battles',
          tabBarIcon: ({ focused }) => <TabBarIcon name="flash" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="rankings"
        options={{
          title: 'Rankings',
          tabBarIcon: ({ focused }) => <TabBarIcon name="list" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ focused }) => <TabBarIcon name="people" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabBarIcon name="person" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
