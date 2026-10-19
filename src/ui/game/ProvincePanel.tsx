import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  actionGold,
  atWar,
  buyCost,
  cellIncome,
  CONFIG,
  developCost,
  festivalCost,
  hasPeaceOffer,
  lootGold,
  maxRecruit,
  squadOf,
  targetHappiness,
  truceUntil,
  unitOf,
  UNIT_TYPES,
  type Action,
  type CellId,
  type GameState,
  type MapDef,
  type PlanResult,
  type PlayerId,
  type UnitType,
} from '../../engine';
import { profileOf } from '../../ai/planOrders';
import type { MatchController } from '../../game/controller';
import { Button, Divider, Segmented, Stepper, Swatch, T, Title } from '../components';
import { fmt, fmtAp, fmtSquad } from '../describe';
import { Icon } from '../icons';
import { COLORS, useLayout } from '../theme';

const A = CONFIG.actions;
const U = CONFIG.units;
const E = CONFIG.economy;

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

const UNIT_HINT: Record<UnitType, string> = {
  inf: `${CONFIG.units.inf.gold} зол. за солдата. Основа армии: в бою первой несёт потери. По своей земле до ${CONFIG.units.inf.range} клеток.`,
  cav: `${CONFIG.units.cav.gold} зол. Атака ×${CONFIG.units.cav.attack}, ходит до ${CONFIG.units.cav.range} клеток. Содержание вдвое дороже.`,
  art: `${CONFIG.units.art.gold} зол. Атака ×${CONFIG.units.art.attack}, оборона ×${CONFIG.units.art.defense}; снимает укрепление врага. До ${CONFIG.units.art.range} клеток.`,
};

const ACTION_LABEL: Record<Action['type'], string> = {
  recruit: 'Найм',
  fortify: 'Укрепление',
  buy: 'Покупка',
  loot: 'Мародёрство',
  festival: 'Праздник',
  develop: 'Хозяйство',
};

/** Панель провинции: данные и действия. Тап по своей провинции открывает действия. */
export function ProvincePanel({
  controller,
  map,
  game,
  plan,
  cell,
  player,
  visible,
  onClose,
  onError,
}: {
  controller: MatchController;
  map: MapDef;
  game: GameState;
  plan: PlanResult;
  cell: CellId;
  player: PlayerId;
  /** Видна ли армия в этой клетке (туман войны). */
  visible: boolean;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const onWar = (target: PlayerId) => {
    const err = controller.declareWar(target);
    if (err) onError(err);
  };
  const onPeace = (target: PlayerId) => {
    const err = controller.offerPeace(target);
    if (err) onError(err);
  };
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

  // Найм: тип войск, не больше 10% населения и сколько хватает золота.
  const [unit, setUnit] = useState<UnitType>('inf');
  const recruitMax = Math.max(0, Math.min(maxRecruit(proj.pop), Math.floor(gold / U[unit].gold)));
  const [count, setCount] = useState(Math.min(10, recruitMax));
  useEffect(() => setCount((c) => Math.max(1, Math.min(c || 1, recruitMax))), [recruitMax]);

  const act = (a: Action) => {
    const err = controller.addAction(a);
    if (err) onError(err);
  };

  const planned = orders.actions.map((a, i) => ({ a, i })).filter((x) => x.a.cell === cell);
  const plannedMoves = orders.moves.map((m, i) => ({ m, i })).filter((x) => x.m.from === cell);
  const hasAction = (t: Action['type']) => planned.some((x) => x.a.type === t);
  const recruitedNow = planned.some((x) => x.a.type === 'recruit' && unitOf(x.a) === unit);
  const adjacentOwn = def.neighbors.some((n) => map.cells[n].kind === 'land' && plan.projected.cells[n].owner === player);

  // Доход этого хода — по действующему налогу, цель счастья — по выбранному (он действует со следующего хода),
  // с усталостью от войны.
  const tax = orders.tax;
  const income = cellIncome(proj, game.players[player].tax);
  const ap = (n: number) => `${fmtAp(n)} ОД`;
  const dev = proj.dev ?? 0;
  const devCost = developCost(dev);
  const squad = squadOf(mine ? proj : st);

  // Провинция другой страны — мир, война или объявление в этом ходу.
  const other = st.owner;
  const foreign = other !== null && other !== player && !!game.players[other]?.alive;
  const declared = foreign && (orders.wars ?? []).includes(other!);
  const warNow = foreign && atWar(game, player, other!);
  const peaceAsked = foreign && (orders.peace ?? []).includes(other!);
  const peaceOffered = foreign && hasPeaceOffer(game, other!, player);
  const truce = foreign ? truceUntil(game, player, other!) : null;
  const otherPlayer = foreign ? game.players[other!] : null;

  return (
    <View style={{ flexShrink: 1 }}>
      <View style={[styles.head, { gap: 8 * s }]}>
        <View style={{ flex: 1 }}>
          <Title size={20} numberOfLines={1}>
            {def.name}
          </Title>
          <View style={[styles.line, { gap: 6 * s }]}>
            {owner ? <Swatch color={owner.color} size={12} /> : null}
            <T dim size={13} numberOfLines={1}>
              {owner ? `${mine ? 'Ваша провинция' : owner.name}${isCapital ? ' · столица' : ''}` : 'Нейтральная провинция'}
            </T>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} hitSlop={10} style={{ padding: 4 * s }}>
          <Icon name="close" size={20 * s} color={COLORS.goldLight} />
        </Pressable>
      </View>
      <Divider />
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 2 * s }}>
        <Line label="Население" value={fmt(st.pop)} />
        {st.owner !== null ? (
          <Line
            label="Счастье"
            value={`${Math.round(st.happiness)}%`}
            hint={mine ? `→ ${Math.round(targetHappiness(plan.projected, player, tax))}%` : undefined}
          />
        ) : null}
        {mine ? <Line label="Доход" value={`+${income.toFixed(1)} за ход`} hint={dev > 0 ? `хозяйство +${dev * E.devIncome * 100}%` : undefined} /> : null}
        {mine && def.kind === 'land' ? <Line label="Хозяйство" value={`${dev} из ${E.devMax}`} /> : null}
        <Line
          label={st.owner === null ? 'Ополчение' : 'Гарнизон'}
          value={!mine && !visible ? '?' : `${mine ? proj.troops : st.troops}${st.fortified ? ' · укреплена ×2' : ''}`}
          hint={
            !mine && !visible ? 'далеко, не видно' : mine && plan.available[cell] !== proj.troops ? `ходят ${plan.available[cell]}` : undefined
          }
        />
        {(mine || visible) && (squad.cav > 0 || squad.art > 0) ? (
          <T dim size={12} style={{ textAlign: 'right' }}>
            {fmtSquad(squad)}
          </T>
        ) : null}
        {foreign && (
          <Line
            label="Отношения"
            value={warNow ? 'война' : declared ? 'война с этого хода' : truce !== null ? `перемирие до хода ${truce}` : 'мир'}
            hint={!warNow && !declared && truce === null ? 'без войны не напасть' : undefined}
          />
        )}
        {otherPlayer?.kind === 'ai' && <Line label="Характер" value={profileOf(otherPlayer.character).label} />}

        {editable && mine && def.kind === 'land' && (
          <View style={{ gap: 8 * s, marginTop: 8 * s }}>
            <View style={{ gap: 6 * s }}>
              <T bold size={14} style={{ color: COLORS.goldLight }}>
                Найм войск
              </T>
              <Segmented<UnitType> options={UNIT_TYPES.map((t) => ({ value: t, label: U[t].label }))} value={unit} onChange={setUnit} />
              <T dim size={11}>
                {UNIT_HINT[unit]}
              </T>
              {recruitMax > 0 && !recruitedNow ? (
                <>
                  <Stepper value={count} min={1} max={recruitMax} big={10} onChange={setCount} />
                  <Button
                    small
                    icon="recruit"
                    label={`Нанять ${count} · ${ap(A.recruit.ap)} · ${count * U[unit].gold} зол.`}
                    onPress={() => act({ type: 'recruit', cell, count, unit })}
                  />
                </>
              ) : (
                <T dim size={12}>
                  {recruitedNow ? 'Этот тип войск здесь уже нанят в этом ходу' : 'Не хватает золота или жителей'}
                </T>
              )}
            </View>
            <Button
              small
              icon="buy"
              label={devCost === null ? 'Хозяйство развито до предела' : `Развить хозяйство · ${ap(A.develop.ap)} · ${devCost} зол.`}
              disabled={devCost === null || hasAction('develop') || plan.apLeft < A.develop.ap || gold < devCost}
              onPress={() => act({ type: 'develop', cell })}
            />
            <Button
              small
              icon="fortify"
              label={st.fortified ? 'Уже укреплена' : `Укрепить · ${ap(A.fortify.ap)} · ${A.fortify.gold} зол.`}
              disabled={st.fortified || hasAction('fortify') || plan.apLeft < A.fortify.ap || gold < A.fortify.gold}
              onPress={() => act({ type: 'fortify', cell })}
            />
            <Button
              small
              icon="happiness"
              label={`Праздник · ${ap(A.festival.ap)} · ${festivalCost(proj.pop)} зол.`}
              disabled={hasAction('festival') || plan.apLeft < A.festival.ap || gold < festivalCost(proj.pop) || proj.happiness >= 100}
              onPress={() => act({ type: 'festival', cell })}
            />
            <Button
              small
              icon="loot"
              label={`Мародёрство · ${ap(A.loot.ap)} · +${lootGold(proj.pop)} зол.`}
              disabled={hasAction('loot') || plan.apLeft < A.loot.ap}
              onPress={() => act({ type: 'loot', cell })}
            />
            <T dim size={11}>
              Хозяйство: +{E.devIncome * 100}% к доходу провинции за уровень, при захвате теряется уровень. Праздник: счастье +
              {A.festival.happiness}%. Мародёрство: население −10%, счастье −20.
            </T>
          </View>
        )}

        {editable && def.kind === 'land' && st.owner === null && adjacentOwn && (
          <View style={{ gap: 6 * s, marginTop: 8 * s }}>
            <Button
              small
              icon="buy"
              label={`Купить · ${ap(A.buy.ap)} · ${buyCost(st.pop)} зол.`}
              disabled={hasAction('buy') || plan.apLeft < A.buy.ap || gold < buyCost(st.pop)}
              onPress={() => act({ type: 'buy', cell })}
            />
          </View>
        )}

        {editable && foreign && !warNow && !declared && truce === null && (
          <View style={{ gap: 4 * s, marginTop: 8 * s }}>
            <Button small variant="danger" icon="swords" label={`Объявить войну: ${game.players[other!].name}`} onPress={() => onWar(other!)} />
            <T dim size={11}>
              Счастье во всех ваших провинциях −{CONFIG.war.happinessLoss}%. Напасть можно уже в этом ходу. Пока идёт война, усталость
              снижает счастье у обеих сторон, а торговли с этой страной нет.
            </T>
          </View>
        )}

        {editable && foreign && warNow && !peaceAsked && (
          <View style={{ gap: 4 * s, marginTop: 8 * s }}>
            <Button
              small
              variant={peaceOffered ? 'primary' : 'secondary'}
              icon="check"
              label={peaceOffered ? `Принять мир: ${game.players[other!].name}` : `Предложить мир: ${game.players[other!].name}`}
              onPress={() => onPeace(other!)}
            />
            <T dim size={11}>
              {peaceOffered
                ? 'Страна предложила мир. Если принять, война закончится в этом ходу.'
                : 'Мир будет, если страна согласится (ответ — в следующем ходу).'}{' '}
              После мира {CONFIG.war.truceTurns} ходов нельзя снова объявить войну.
            </T>
          </View>
        )}

        {!mine && def.kind === 'land' && st.owner !== player && (
          <T dim size={12} style={{ marginTop: 8 * s }}>
            {st.owner === null
              ? 'Захват: приведите армию сильнее ополчения или купите провинцию по соседству.'
              : 'Атака побеждает, только если она сильнее защиты; ничья — в пользу защиты.'}
          </T>
        )}

        {(planned.length > 0 || plannedMoves.length > 0 || declared || peaceAsked) && (
          <View style={{ marginTop: 10 * s, gap: 4 * s }}>
            <T bold size={13} style={{ color: COLORS.goldLight }}>
              Приказы здесь
            </T>
            {planned.map(({ a, i }) => (
              <OrderRow
                key={`a${i}`}
                text={`${ACTION_LABEL[a.type]}${a.type === 'recruit' ? ` ${a.count} · ${U[unitOf(a)].label.toLowerCase()}` : ''}${actionGold(game, a) > 0 ? ` · −${actionGold(game, a)} зол.` : ''}`}
                onRemove={editable ? () => controller.removeAction(i) : undefined}
              />
            ))}
            {declared && (
              <OrderRow
                text={`Объявление войны: ${game.players[other!].name}`}
                onRemove={editable ? () => controller.cancelWar(other!) : undefined}
              />
            )}
            {peaceAsked && (
              <OrderRow
                text={`${peaceOffered ? 'Принять мир' : 'Предложение мира'}: ${game.players[other!].name}`}
                onRemove={editable ? () => controller.cancelPeace(other!) : undefined}
              />
            )}
            {plannedMoves.map(({ m, i }) => (
              <OrderRow
                key={`m${i}`}
                text={`${m.count}${m.cav || m.art ? ` (${fmtSquad({ inf: m.count - (m.cav ?? 0) - (m.art ?? 0), cav: m.cav ?? 0, art: m.art ?? 0 })})` : ''} → ${map.cells[m.to].name}`}
                onRemove={editable ? () => controller.removeMove(i) : undefined}
              />
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
