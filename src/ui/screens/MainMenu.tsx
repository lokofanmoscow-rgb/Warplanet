import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createGame, getMap, resolveTurn } from '../../engine';
import { planAllAI } from '../../ai/planOrders';
import { continueSaved } from '../../game/sessions';
import { getPlayerName, loadGame, setPlayerName, type SaveData } from '../../game/storage';
import { DEFAULT_MAP_ID } from '../../maps';
import { networkAvailable } from '../../net/platform';
import { Button, Panel, T, Title } from '../components';
import { MapView } from '../map/MapView';
import { useNav } from '../nav';
import { COLORS, FONTS, useLayout } from '../theme';

const MODE_LABEL: Record<SaveData['mode'], string> = {
  ai: 'против ИИ',
  hotseat: 'на одном телефоне',
  host: 'по Wi-Fi',
};

/** Партия ИИ на фоне меню — карта сразу выглядит живой. */
function useDemoGame() {
  return useMemo(() => {
    const map = getMap(DEFAULT_MAP_ID);
    let g = createGame({
      map,
      seed: 20261017,
      players: Array.from({ length: 8 }, (_, i) => ({ name: `ИИ ${i}`, kind: 'ai' as const, difficulty: 'hard' as const })),
    });
    for (let i = 0; i < 14; i++) g = resolveTurn(g, planAllAI(g));
    return g;
  }, []);
}

export function MainMenu() {
  const { go } = useNav();
  const { s, landscape, height } = useLayout();
  const insets = useSafeAreaInsets();
  const demo = useDemoGame();
  const map = getMap(demo.mapId);
  const [save, setSave] = useState<SaveData | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadGame().then(setSave);
    void getPlayerName().then(setName);
  }, []);

  const onContinue = async () => {
    if (!save) return;
    setLoading(true);
    setError(null);
    try {
      const controller = await continueSaved(save);
      go({ name: 'game', controller });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось продолжить партию');
      setLoading(false);
    }
  };

  const compact = height < 520;

  return (
    <View style={styles.fill}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <MapView map={map} game={demo} units={[]} interactive={false} drift />
      </View>
      <View style={[StyleSheet.absoluteFill, styles.dim]} pointerEvents="none" />
      <ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={[
          styles.center,
          { paddingTop: insets.top + 16 * s, paddingBottom: insets.bottom + 16 * s, flexDirection: landscape && compact ? 'row' : 'column', gap: 24 * s },
        ]}
      >
        <View style={{ alignItems: 'center' }}>
          <Title size={compact ? 46 : 58} style={styles.title}>
            WarPlanet
          </Title>
          <T dim size={15} style={{ marginTop: -4 * s }}>
            Пошаговая стратегия про захват провинций
          </T>
        </View>
        <Panel style={{ width: Math.min(380 * s, 520) }}>
          <View style={{ gap: (compact ? 6 : 10) * s }}>
            <Button small={compact} label="Против ИИ" variant="primary" icon="swords" onPress={() => go({ name: 'setup', mode: 'ai' })} />
            <Button small={compact} label="Создать игру" icon="wifi" disabled={!networkAvailable} onPress={() => go({ name: 'host' })} />
            <Button small={compact} label="Найти игру" icon="people" disabled={!networkAvailable} onPress={() => go({ name: 'find' })} />
            <Button small={compact} label="На одном телефоне" icon="people" onPress={() => go({ name: 'setup', mode: 'hotseat' })} />
            <Button
              small={compact}
              label={save ? `Продолжить · ход ${save.game.turn}, ${MODE_LABEL[save.mode]}` : 'Продолжить'}
              icon="log"
              disabled={!save || loading}
              onPress={onContinue}
            />
            {loading && <ActivityIndicator color={COLORS.gold} />}
            {error && (
              <T size={13} style={{ color: COLORS.danger }}>
                {error}
              </T>
            )}
            {!networkAvailable && (
              <T dim size={12}>
                Игра по Wi-Fi работает в установленном приложении на Android.
              </T>
            )}
            <View style={styles.nameRow}>
              <T dim size={13}>
                Ваше имя
              </T>
              <TextInput
                value={name}
                onChangeText={setName}
                onEndEditing={() => void setPlayerName(name)}
                onBlur={() => void setPlayerName(name)}
                maxLength={24}
                placeholder="Игрок"
                placeholderTextColor={COLORS.textDim}
                style={[styles.input, { fontSize: 15 * s, paddingVertical: 6 * s }]}
              />
            </View>
          </View>
        </Panel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: COLORS.seaDeep },
  dim: { backgroundColor: 'rgba(20,14,9,0.45)' },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  title: {
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 2, height: 3 },
    textShadowRadius: 6,
    letterSpacing: 1,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  input: {
    flex: 1,
    color: COLORS.text,
    fontFamily: FONTS.bold,
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.goldDark,
    paddingHorizontal: 4,
  },
});
