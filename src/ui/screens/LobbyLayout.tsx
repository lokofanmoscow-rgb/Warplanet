import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createGame, getMap, militiaFor, type CellId, type GameState } from '../../engine';
import { Button, Panel, T, Title } from '../components';
import { MapView } from '../map/MapView';
import { COLORS, useLayout } from '../theme';

const previews = new Map<string, GameState>();

/** Пустая карта для выбора стартовой точки: вся суша нейтральна. */
export function previewGame(mapId: string): GameState {
  const hit = previews.get(mapId);
  if (hit) return hit;
  const map = getMap(mapId);
  const g = createGame({ map, seed: 1, players: [{ name: '-', kind: 'ai' }, { name: '-', kind: 'ai' }] });
  g.cells.forEach((c, i) => {
    if (map.cells[i].kind !== 'land') return;
    c.owner = null;
    c.troops = militiaFor(c.pop);
  });
  g.players.forEach((p) => {
    p.capital = null;
    p.alive = false;
  });
  previews.set(mapId, g);
  return g;
}

export interface StartMarker {
  cell: CellId;
  color: string | null;
  label?: string;
}

/** Экран лобби: карта для выбора стартовой точки и панель настроек. */
export function LobbyLayout({
  title,
  mapId,
  markers,
  onPickStart,
  onBack,
  children,
  footer,
}: {
  title: string;
  mapId: string;
  markers: StartMarker[];
  onPickStart?: (cell: CellId) => void;
  onBack: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { s, landscape, width } = useLayout();
  const insets = useSafeAreaInsets();
  const map = getMap(mapId);
  const game = useMemo(() => previewGame(mapId), [mapId]);
  const wide = landscape && width >= 640;
  const panelW = Math.min(420 * s, width * 0.46);

  const panel = (
    <Panel style={wide ? { flex: 1 } : { flex: 1 }}>
      <View style={[styles.header, { gap: 10 * s, marginBottom: 10 * s }]}>
        <Button label="Назад" small onPress={onBack} />
        <Title size={22} style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </Title>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 * s }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer ? <View style={{ marginTop: 8 * s }}>{footer}</View> : null}
    </Panel>
  );

  return (
    <View style={[styles.root, { flexDirection: wide ? 'row' : 'column' }]}>
      <View style={{ flex: 1 }}>
        {/* key: при смене карты вид строится заново и подгоняется под новую карту. */}
        <MapView
          key={mapId}
          map={map}
          game={game}
          units={[]}
          startPoints={markers}
          onTapCell={(cell) => {
            if (cell !== null && map.startPoints.includes(cell)) onPickStart?.(cell);
          }}
        />
        <View style={[styles.hint, { top: insets.top + 10 * s, left: insets.left + 10 * s, padding: 8 * s, borderRadius: 8 * s }]} pointerEvents="none">
          <T size={13}>Нажмите на кольцо на карте, чтобы выбрать стартовую столицу</T>
        </View>
      </View>
      <View
        style={
          wide
            ? { width: panelW, paddingTop: insets.top + 8 * s, paddingBottom: insets.bottom + 8 * s, paddingRight: insets.right + 8 * s, paddingLeft: 8 * s }
            : { height: '55%', paddingBottom: insets.bottom + 8 * s, paddingHorizontal: 8 * s, paddingTop: 8 * s }
        }
      >
        {panel}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.panelDeep },
  header: { flexDirection: 'row', alignItems: 'center' },
  hint: { position: 'absolute', backgroundColor: 'rgba(43,33,24,0.85)', borderWidth: 1, borderColor: COLORS.goldDark, maxWidth: 360 },
});
