import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMap, ownedLandCount, type GameState } from '../../engine';
import type { Mode } from '../../game/controller';
import { Button, Panel, Swatch, T, Title } from '../components';
import { END_REASON } from '../describe';
import { useNav } from '../nav';
import { COLORS, useLayout } from '../theme';
import { feedback } from '../sound';
import { StatsChart } from './StatsChart';

export function ResultsScreen({ game, viewer }: { game: GameState; mode: Mode; viewer: number | null }) {
  const { go } = useNav();
  const { s, width } = useLayout();
  const insets = useSafeAreaInsets();
  const map = getMap(game.mapId);
  const winner = game.winner !== null ? game.players[game.winner] : null;
  const won = winner !== null && winner.id === viewer;
  const rows = [...game.players].sort(
    (a, b) => ownedLandCount(game, map, b.id) - ownedLandCount(game, map, a.id) || Number(b.alive) - Number(a.alive),
  );
  const chartW = Math.min(560 * s, width - 60);
  // Победа — фанфара; поражение или чужая победа — минор.
  useEffect(() => {
    feedback(won || (winner === null && viewer !== null && game.players[viewer]?.alive) ? 'victory' : 'defeat', won ? 'success' : 'warning');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.center, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      <Panel style={{ width: Math.min(600 * s, width - 24) }}>
        <View style={{ alignItems: 'center', gap: 6 * s }}>
          <Title size={34}>{winner ? (won ? 'Победа!' : `Победил ${winner.name}`) : 'Партия окончена'}</Title>
          {game.endReason && <T dim>Итог: {END_REASON[game.endReason]}, ход {game.turn}</T>}
        </View>
        <View style={{ marginVertical: 16 * s, gap: 6 * s }}>
          {rows.map((p) => (
            <View key={p.id} style={[styles.row, { gap: 10 * s }]}>
              <Swatch color={p.color} />
              <T bold style={{ flex: 1 }} numberOfLines={1}>
                {p.name}
                {p.kind === 'ai' ? ' (ИИ)' : ''}
              </T>
              <T>{ownedLandCount(game, map, p.id)} пров.</T>
              <T dim style={{ width: 120 * s, textAlign: 'right' }}>
                {p.alive ? 'в игре' : `выбыл на ходу ${p.eliminatedTurn ?? '?'}`}
              </T>
            </View>
          ))}
        </View>
        {game.history.length > 1 && (
          <View style={{ gap: 6 * s, marginBottom: 16 * s }}>
            <T bold size={14} style={{ color: COLORS.goldLight }}>
              Ход партии
            </T>
            <StatsChart game={game} width={chartW} height={170 * s} />
          </View>
        )}
        <Button label="В главное меню" variant="primary" onPress={() => go({ name: 'menu' })} />
      </Panel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.panelDeep },
  center: { alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
});
