import React, { useEffect, useState, useRef } from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import PlayerScreen from './src/screens/Player';
import { OnboardingContent } from './src/components/OnboardingModal';
import { SettingsDao } from './src/db/settingsDao';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { PlaybackController } from './src/engine/PlaybackController';

export default function App() {
  const [isOnboardingResolved, setIsOnboardingResolved] = useState<boolean>(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [playerMountKey, setPlayerMountKey] = useState<number>(0);
  // Keep controller outside remount boundary; parent initialize can safely rerun on same object.
  const controllerRef = useRef<PlaybackController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new PlaybackController();
  }

  const handlePlayerReset = () => {
    setPlayerMountKey((k) => k + 1);
  };

  useEffect(() => {
    let isMounted = true;
    SettingsDao.isOnboardingCompleted()
      .then((completed) => {
        if (!isMounted) return;
        setShowOnboarding(!completed);
      })
      .catch(() => {
        if (!isMounted) return;
        setShowOnboarding(false);
      })
      .finally(() => {
        if (isMounted) {
          setIsOnboardingResolved(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (!isOnboardingResolved) {
    return (
      <SafeAreaProvider style={{ flex: 1, backgroundColor: '#0B0D12' }}>
        <StatusBar barStyle="light-content" backgroundColor="#0B0D12" hidden />
        <View style={{ flex: 1, backgroundColor: '#0B0D12' }} />
      </SafeAreaProvider>
    );
  }

  if (showOnboarding) {
    return (
      <SafeAreaProvider style={{ flex: 1, backgroundColor: '#0B0D12' }}>
        <StatusBar barStyle="light-content" backgroundColor="#0B0D12" hidden={false} />
        <OnboardingContent onClose={() => setShowOnboarding(false)} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: '#0B0D12' }}>
      <ErrorBoundary scope="root" fallbackTitle="Application Error">
        <ErrorBoundary scope="player" fallbackTitle="Player Error" onReset={handlePlayerReset}>
          <PlayerScreen key={playerMountKey} controller={controllerRef.current} />
        </ErrorBoundary>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
