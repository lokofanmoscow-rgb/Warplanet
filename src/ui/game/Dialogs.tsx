import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CONFIG,
  getMap,
  happinessTarget,
  previewEconomy,
  type CellId,
  type GameState,
  type MapDef,
  type PlayerId,
} from '../../engine';
import { Button, Panel, Row, Stepper, Swatch, T, Title } from '../components';
import { describeLog } from '../describe';
import { COLORS, useLayout } from '../theme';

export function Overlay({ children, onDismiss, maxWidth = 460 }: { children: React.ReactNode; onDismiss?: () => void; maxWidth?: number }) {
  const { s, height } = useLayout();
  const insets = useSafeAreaInsets();
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} accessibilityLabel="Закрыть" />
      <Panel style={{ width: '92%', maxWidth: maxWidth * s, maxHeight: height - insets.top - insets.bottom - 24 }}>{children}</Panel>
    </View>
  );
}

/** Выбор числа солдат для приказа на движение. */
export function MoveDialog({
  map,
  from,
  to,
  available,
  onConfirm,
  onCancel,
}: {
  map: MapDef;
  from: CellId;
  to: CellId;
  available: number;
  onConfirm: (count: number) => void;
  onCancel: () => void;
}) {
  const { s } = useLayout();
  const [count, setCount] = useState(available);
  const sea = map.cells[to].kind === 'sea';
  return (
    <Overlay onDismiss={onCancel}>
      <Title size={20}>Приказ на движение</Title>
      <T dim size={14} style={{ marginTop: 4 * s }}>
        {map.cells[from].name} → {map.cells[to].name}
      </T>
      {sea && (
        <T dim size={12} style={{ marginTop: 4 * s }}>
          В море армия плывёт на кораблях: сила ×0,5, содержание вдвое дороже.
        </T>
      )}
      <View style={{ alignItems: 'center', marginVertical: 16 * s, gap: 10 * s }}>
        <Stepper value={count} min={1} max={available} big={10} onChange={setCount} />
        <Row gap={8}>
          <Button small label="Половина" onPress={() => setCount(Math.max(1, Math.floor(available / 2)))} />
          <Button small label={`Все (${available})`} onPress={() => setCount(available)} />
        </Row>
      </View>
      <Row gap={10}>
        <Button label="Отмена" onPress={onCancel} style={{ flex: 1 }} />
        <Button label="Отправить" variant="primary" icon="move" onPress={() => onConfirm(count)} style={{ flex: 1 }} />
      </Row>
    </Overlay>
  );
}

/** Налог — одна ставка на всю страну, 0–200% с шагом 10%. */
export function TaxDialog({
  game,
  player,
  value,
  editable,
  onConfirm,
  onCancel,
}: {
  game: GameState;
  player: PlayerId;
  value: number;
  editable: boolean;
  onConfirm: (tax: number) => void;
  onCancel: () => void;
}) {
  const { s } = useLayout();
  const [tax, setTax] = useState(value);
  const map = getMap(game.mapId);
  const eco = previewEconomy(game, map, player, tax);
  const E = CONFIG.economy;
  return (
    <Overlay onDismiss={onCancel}>
      <Title size={20}>Налог</Title>
      <T dim size={13} style={{ marginTop: 4 * s }}>
        Высокий налог даёт больше золота, но снижает счастье. Счастье каждый ход сдвигается на {E.happinessStep} пунктов к цели.
      </T>
      <View style={{ alignItems: 'center', marginVertical: 14 * s }}>
        <Stepper value={tax} min={E.taxMin} max={E.taxMax} step={E.taxStep} big={50} format={(v) => `${v}%`} onChange={editable ? setTax : () => {}} />
      </View>
      <View style={{ gap: 4 * s, marginBottom: 14 * s }}>
        <T>Цель счастья: {Math.round(happinessTarget(tax))}%</T>
        <T>
          Доход: +{eco.income}, содержание армии: −{eco.upkeep}
        </T>
        <T dim size={12}>
          Доход полный при счастье от {E.fullAt}%, четверть при {E.partialAt}–{E.fullAt - 1}%, ниже — нет дохода.
        </T>
      </View>
      <Row gap={10}>
        <Button label="Отмена" onPress={onCancel} style={{ flex: 1 }} />
        <Button label="Готово" variant="primary" disabled={!editable} onPress={() => onConfirm(tax)} style={{ flex: 1 }} />
      </Row>
    </Overlay>
  );
}

/** Короткий журнал хода: бои, захваты, доход. */
export function LogDialog({
  game,
  map,
  viewer,
  onClose,
}: {
  game: GameState;
  map: MapDef;
  viewer: PlayerId | null;
  onClose: () => void;
}) {
  const { s } = useLayout();
  const lines = describeLog(game, map, viewer);
  const resolved = game.finished ? game.turn : game.turn - 1;
  return (
    <Overlay onDismiss={onClose} maxWidth={560}>
      <Title size={20}>Итоги хода {resolved}</Title>
      <ScrollView style={{ marginVertical: 10 * s, flexShrink: 1 }} contentContainerStyle={{ gap: 6 * s }}>
        {lines.length === 0 && <T dim>Спокойный ход: ни боёв, ни захватов.</T>}
        {lines.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8 * s, alignItems: 'flex-start' }}>
            <View style={{ marginTop: 4 * s }}>
              <Swatch color={l.player !== null ? game.players[l.player]?.color ?? COLORS.neutral : COLORS.neutral} size={10} />
            </View>
            <T size={14} style={{ flex: 1, color: l.kind === 'good' ? COLORS.ok : l.kind === 'bad' ? COLORS.danger : COLORS.text }}>
              {l.text}
            </T>
          </View>
        ))}
      </ScrollView>
      <Button label="Дальше" variant="primary" onPress={onClose} />
    </Overlay>
  );
}

/** На одном телефоне: передать телефон следующему игроку. */
export function HandoffScreen({ game, player, onReady }: { game: GameState; player: PlayerId; onReady: () => void }) {
  const { s } = useLayout();
  const p = game.players[player];
  return (
    <View style={[StyleSheet.absoluteFill, styles.handoff]}>
      <Panel style={{ maxWidth: 420 * s, width: '90%' }}>
        <View style={{ alignItems: 'center', gap: 12 * s }}>
          <T dim>Ход {game.turn}</T>
          <View style={{ width: 54 * s, height: 54 * s, borderRadius: 27 * s, backgroundColor: p.color, borderWidth: 3, borderColor: COLORS.goldLight }} />
          <Title size={26} style={{ textAlign: 'center' }}>
            Передайте телефон: {p.name}
          </Title>
          <T dim size={13} style={{ textAlign: 'center' }}>
            Приказы других игроков скрыты.
          </T>
          <Button label="Я готов отдавать приказы" variant="primary" onPress={onReady} style={{ alignSelf: 'stretch' }} />
        </View>
      </Panel>
    </View>
  );
}

export function GameMenu({
  canSave,
  onResume,
  onLog,
  onExit,
}: {
  canSave: boolean;
  onResume: () => void;
  onLog: () => void;
  onExit: () => void;
}) {
  const { s } = useLayout();
  return (
    <Overlay onDismiss={onResume} maxWidth={360}>
      <Title size={22} style={{ textAlign: 'center', marginBottom: 12 * s }}>
        Меню
      </Title>
      <View style={{ gap: 10 * s }}>
        <Button label="Продолжить" variant="primary" onPress={onResume} />
        <Button label="Журнал прошлого хода" icon="log" onPress={onLog} />
        <Button label={canSave ? 'Сохранить и выйти' : 'Выйти в меню'} variant="danger" onPress={onExit} />
        {canSave && (
          <T dim size={12} style={{ textAlign: 'center' }}>
            Партия сохраняется после каждого хода — её можно продолжить из главного меню.
          </T>
        )}
      </View>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.overlay },
  handoff: { alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.panelDeep },
});
