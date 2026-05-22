import { useEffect } from 'react';
import { router } from 'expo-router';
import { Spinner } from '@ui/Spinner';

// Modal entry point — immediately bounces to the Battles tab.
// Kept so the fullScreenModal route registration in _layout.tsx stays valid.
export default function BattleModal() {
  useEffect(() => {
    router.replace('/(tabs)/battles');
  }, []);

  return <Spinner fullScreen />;
}
