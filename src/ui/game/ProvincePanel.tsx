import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  actionGold,
  buyCost,
  CONFIG,
  happinessTarget,
  incomeFactor,
  lootGold,
  maxRecruit,
  type Action,
  type CellId,
  type GameState,
  type MapDef,
  type PlanResult,
  type PlayerId,
} from '../../engine';
import type { MatchController } from '../../game/controller';
import { Button, Divider, Stepper, Swatch, T, Title } from '../components';
import { fmt } from '../describe';
import { Icon } from '../icons';
import { COLORS, useLayout } from '../theme';

const A = CONFIG.actions;

function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const { s } = useLayout();
  return (
    <View style={[styles.line, { gap: 8 * s, paddingVertical: 2 * s }]}>
      <T dim size={14} style={{ flex: 1 }}>
        {label}
      </T>
      <T bold size={14}>
        {value}
      </T>
      {hint ? (
        <T dim size={12}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

const ACTION_LABEL: Record<Action['type'], string> = {
  recruit: 'Найм',
  fortify: 'Укрепление',
  buy: 'Покупка',
  loot: 'Мародёрство',
};

/** Панель провинции: данные и действия. Тап по своей провинции открывает действия. */
export function ProvincePanel({
  controller,
  map,
  game,
  plan,
  cell,
  player,
  onMove,
  onClose,
  onError,
}: {
  controller: MatchController;
  map: MapDef;
  game: GameState;
  plan: PlanResult;
  cell: CellId;
  player: PlayerId;
  onMove: (from: CellId) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const { s } = useLayout();
  const def = map.cells[cell];
  const st = game.cells[cell];
  const proj = plan.projected.cells[cell];
  const editable = controller.canEdit();
  const orders = controller.orders();
  const mine = st.owner === player;
  const owner = st.owner !== null ? game.players[st.owner] : null;
  const isCapital = game.players.some((p) => p.capital === cell && p.alive);
  const gold = plan.goldLeft;

  // Найм: не больше 10% населения и сколько хватает золота.
  const recruitMax = Math.max(0, Math.min(maxRecruit(proj.pop), Math.floor(gold / A.recruit.goldPerSoldier)));
  const [count, setCount] = useState(Math.min(10, recruitMax));
  useEffect(() => setCount((c) => Math.max(1, Math.min(c || 1, recruitMax))), [recruitMax]);

  const act = (a: Action) => {
    const err = controller.addAction(a);
    if (err) onError(err);
  };

  const planned = orders.actions.map((a, i) => ({ a, i })).filter((x) => x.a.cell === cell);
  const plannedMoves = orders.moves.map((m, i) => ({ m, i })).filter((x) => x.m.from === cell);
  const hasAction = (t: Action['type']) => planned.some((x) => x.a.type === t);
  const available = plan.available[cell] ?? 0;
  const adjacentOwn = def.neighbors.some((n) => map.cells[n].kind === 'land' && plan.projected.cells[n].owner === player);

  const tax = orders.tax;
  const income = (st.pop / CONFIG.economy.popPerGold) * (tax / 100) * incomeFactor(st.happiness);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.head, { gap: 8 * s }]}>
        <View style={{ flex: 1 }}>
          <Title size={20} numberOfLines={1}>
            {def.name}
          </Title>
          <View style={[styles.line, { gap: 6 * s }]}>
            {owner ? <Swatch color={owner.color} size={12} /> : null}
            <T dim size={13} numberOfLines={1}>
              {def.kind === 'sea'
                ? 'Морская зона'
                : owner
                  ? `${mine ? 'Ваша провинция' : owner.name}${isCapital ? ' · столица' : ''}`
                  : 'Нейтральная провинция'}
            </T>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} hitSlop={10} style={{ padding: 4 * s }}>
          <Icon name="close" size={20 * s} color={COLORS.goldLight} />
        </Pressable>
      </View>
      <Divider />
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 2 * s }}>
        {def.kind === 'land' ? (
          <>
            <Line label="Население" value={fmt(st.pop)} />
            {st.owner !== null ? (
              <Line label="Счастье" value={`${Math.round(st.happiness)}%`} hint={mine ? `→ ${Math.round(happinessTarget(tax))}%` : undefined} />
            ) : null}
            {mine ? <Line label="Доход" value={`+${income.toFixed(1)} за ход`} /> : null}
            <Line
              label={st.owner === null ? 'Ополчение' : 'Гарнизон'}
              value={`${st.troops}${st.fortified ? ' · укреплена ×2' : ''}`}
              hint={mine && available !== st.troops ? `доступно ${available}` : undefined}
            />
          </>
        ) : (
          <Line label="Армия" value={st.troops > 0 && owner ? `${st.troops} · ${owner.name}` : 'нет'} />
        )}

        {editable && mine && def.kind === 'land' && (
          <View style={{ gap: 8 * s, marginTop: 8 * s }}>
            <View style={{ gap: 6 * s }}>
              <T bold size={14} style={{ color: COLORS.goldLight }}>
                Найм войск
              </T>
              {recruitMax > 0 && !hasAction('recruit') ? (
                <>
                  <Stepper value={count} min={1} max={recruitMax} big={10} onChange={setCount} />
                  <Button
                    small
                    icon="recruit"
                    label={`Нанять ${count} · ${A.recruit.ap} ОД · ${count * A.recruit.goldPerSoldier} зол.`}
                    onPress={() => act({ type: 'recruit', cell, count })}
                  />
                </>
              ) : (
                <T dim size={12}>
                  {hasAction('recruit') ? 'Уже нанято в этом ходу' : 'Не хватает золота или жителей'}
                </T>
              )}
            </View>
            <Button
              small
              icon="fortify"
              label={st.fortified ? 'Уже укреплена' : `Укрепить · ${A.fortify.ap} ОД · ${A.fortify.gold} зол.`}
              disabled={st.fortified || hasAction('fortify') || plan.apLeft < A.fortify.ap || gold < A.fortify.gold}
              onPress={() => act({ type: 'fortify', cell })}
            />
            <Button
              small
              icon="loot"
              label={`Мародёрство · ${A.loot.ap} ОД · +${lootGold(proj.pop)} зол.`}
              disabled={hasAction('loot') || plan.apLeft < A.loot.ap}
              onPress={() => act({ type: 'loot', cell })}
            />
            <T dim size={11}>
              Мародёрство: население −10%, счастье −20.
            </T>
          </View>
        )}

        {editable && def.kind === 'land' && st.owner === null && adjacentOwn && (
          <View style={{ gap: 6 * s, marginTop: 8 * s }}>
            <Button
              small
              icon="buy"
              label={`Купить · ${A.buy.ap} ОД · ${buyCost(st.pop)} зол.`}
              disabled={hasAction('buy') || plan.apLeft < A.buy.ap || gold < buyCost(st.pop)}
              onPress={() => act({ type: 'buy', cell })}
            />
          </View>
        )}

        {editable && st.owner === player && available > 0 && (
          <Button small icon="move" label={`Отправить армию (${available})`} onPress={() => onMove(cell)} style={{ marginTop: 8 * s }} />
        )}

        {!mine && def.kind === 'land' && st.owner !== player && (
          <T dim size={12} style={{ marginTop: 8 * s }}>
            {st.owner === null
              ? 'Захват: приведите армию сильнее ополчения или купите провинцию по соседству.'
              : 'Атака побеждает, только если она сильнее защиты; ничья — в пользу защиты.'}
          </T>
        )}

        {(planned.length > 0 || plannedMoves.length > 0) && (
          <View style={{ marginTop: 10 * s, gap: 4 * s }}>
            <T bold size={13} style={{ color: COLORS.goldLight }}>
              Приказы здесь
            </T>
            {planned.map(({ a, i }) => (
              <OrderRow
                key={`a${i}`}
                text={`${ACTION_LABEL[a.type]}${a.type === 'recruit' ? ` ${a.count}` : ''}${actionGold(game, a) > 0 ? ` · −${actionGold(game, a)} зол.` : ''}`}
                onRemove={editable ? () => controller.removeAction(i) : undefined}
              />
            ))}
            {plannedMoves.map(({ m, i }) => (
              <OrderRow key={`m${i}`} text={`${m.count} → ${map.cells[m.to].name}`} onRemove={editable ? () => controller.removeMove(i) : undefined} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function OrderRow({ text, onRemove }: { text: string; onRemove?: () => void }) {
  const { s } = useLayout();
  return (
    <View style={[styles.line, { gap: 8 * s, backgroundColor: COLORS.panelDeep, padding: 6 * s, borderRadius: 6 * s }]}>
      <T size={13} style={{ flex: 1 }}>
        {text}
      </T>
      {onRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Отменить приказ" onPress={onRemove} hitSlop={8}>
          <Icon name="close" size={16 * s} color={COLORS.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  line: { flexDirection: 'row', alignItems: 'center' },
});
