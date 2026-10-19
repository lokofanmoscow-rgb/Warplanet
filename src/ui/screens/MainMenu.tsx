import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createGame, getMap, resolveTurn } from '../../engine';
import { planAllAI } from '../../ai/planOrders';
import { continueSaved } from '../../game/sessions';
import { clearSave, getPlayerName, listSaves, loadSave, setPlayerName, type SaveMeta } from '../../game/storage';
import { DEFAULT_MAP_ID } from '../../maps';
import { networkAvailable } from '../../net/platform';
import { Button, Panel, Swatch, T, Title } from '../components';
import { Overlay } from '../game/Dialogs';
import { Icon } from '../icons';
import { MapView } from '../map/MapView';
import { useNav } from '../nav';
import { COLORS, FONTS, useLayout } from '../theme';

const MODE_LABEL: Record<SaveMeta['mode'], string> = {
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
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [savesOpen, setSavesOpen] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listSaves().then(setSaves);
    void getPlayerName().then(setName);
  }, []);

  const open = async (meta: SaveMeta) => {
    setSavesOpen(false);
    setLoading(true);
    setError(null);
    try {
      const save = await loadSave(meta.id);
      if (!save) throw new Error('Сохранение не читается');
      const controller = await continueSaved(save);
      go({ name: 'game', controller });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось продолжить партию');
      setLoading(false);
    }
  };
  // Одна партия — сразу в неё, несколько — список.
  const onContinue = () => {
    if (saves.length === 1) void open(saves[0]);
    else if (saves.length > 1) setSavesOpen(true);
  };
  const remove = async (meta: SaveMeta) => {
    await clearSave(meta.id);
    setSaves(await listSaves());
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
              label={
                saves.length === 1
                  ? `Продолжить · ход ${saves[0].turn}, ${MODE_LABEL[saves[0].mode]}`
                  : saves.length > 1
                    ? `Продолжить · ${saves.length} партии`
                    : 'Продолжить'
              }
              icon="log"
              disabled={saves.length === 0 || loading}
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
      {savesOpen && <SavesDialog saves={saves} onOpen={(m) => void open(m)} onDelete={(m) => void remove(m)} onClose={() => setSavesOpen(false)} />}
    </View>
  );
}

/** Список сохранённых партий: продолжить или удалить. */
function SavesDialog({
  saves,
  onOpen,
  onDelete,
  onClose,
}: {
  saves: SaveMeta[];
  onOpen: (m: SaveMeta) => void;
  onDelete: (m: SaveMeta) => void;
  onClose: () => void;
}) {
  const { s } = useLayout();
  const date = (t: number) => {
    const d = new Date(t);
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return (
    <Overlay onDismiss={onClose} maxWidth={480}>
      <Title size={22}>Сохранённые партии</Title>
      <ScrollView style={{ marginVertical: 10 * s, flexShrink: 1 }} contentContainerStyle={{ gap: 8 * s }}>
        {saves.map((m) => (
          <View key={m.id} style={[styles.saveRow, { gap: 8 * s, padding: 8 * s, borderRadius: 8 * s }]}>
            <Pressable accessibilityRole="button" onPress={() => onOpen(m)} style={{ flex: 1, gap: 3 * s }}>
              <T bold>
                {getMap(m.mapId).name} · ход {m.turn}
              </T>
              <T dim size={12}>
                {MODE_LABEL[m.mode]} · {date(m.savedAt)}
              </T>
              <View style={[styles.swatches, { gap: 4 * s }]}>
                {m.players.map((p, i) => (
                  <View key={i} style={{ opacity: p.alive ? 1 : 0.3 }}>
                    <Swatch color={p.color} size={p.human ? 14 : 10} />
                  </View>
                ))}
              </View>
            </Pressable>
            <Button small label="Играть" variant="primary" onPress={() => onOpen(m)} />
            <Pressable accessibilityRole="button" accessibilityLabel="Удалить партию" onPress={() => onDelete(m)} hitSlop={8} style={{ padding: 4 * s }}>
              <Icon name="close" size={18 * s} color={COLORS.danger} />
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <T dim size={11} style={{ marginBottom: 8 * s }}>
        Хранится до 6 партий: при новой самая давняя удаляется.
      </T>
      <Button label="Закрыть" onPress={onClose} />
    </Overlay>
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
  saveRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.panelDeep, borderWidth: 1, borderColor: COLORS.goldDark },
  swatches: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    color: COLORS.text,
    fontFamily: FONTS.bold,
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.goldDark,
    paddingHorizontal: 4,
  },
});
