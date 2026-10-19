import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../maps';
import { NavProvider, type Screen } from './nav';
import { COLORS, FONT_FILES } from './theme';
import { MainMenu } from './screens/MainMenu';
import { SetupScreen } from './screens/SetupScreen';
import { HostLobby } from './screens/HostLobby';
import { FindGame } from './screens/FindGame';
import { GameScreen } from './screens/GameScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { initSound } from './sound';

export default function App() {
  const [fontsLoaded] = useFonts(FONT_FILES);
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });

  const go = useCallback((next: Screen) => setScreen(next), []);

  useEffect(() => {
    void initSound();
  }, []);

  // Кнопка «назад» Android: из вспомогательных экранов — в меню; в партии её обрабатывает экран игры.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen.name === 'menu' || screen.name === 'game') return false;
      setScreen({ name: 'menu' });
      return true;
    });
    return () => sub.remove();
  }, [screen.name]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar hidden style="light" />
        <View style={styles.root}>
          {fontsLoaded ? (
            <NavProvider value={{ screen, go }}>
              {screen.name === 'menu' && <MainMenu />}
              {screen.name === 'setup' && <SetupScreen mode={screen.mode} />}
              {screen.name === 'host' && <HostLobby />}
              {screen.name === 'find' && <FindGame />}
              {screen.name === 'game' && <GameScreen key={screen.controller.game.id} controller={screen.controller} />}
              {screen.name === 'results' && <ResultsScreen game={screen.game} mode={screen.mode} viewer={screen.viewer} />}
            </NavProvider>
          ) : null}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.panel },
});
