import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CONFIG,
  forecastIncome,
  getMap,
  previewEconomy,
  squadSize,
  targetHappiness,
  tradePartners,
  UNIT_TYPES,
  warWeariness,
  type CellId,
  type GameState,
  type MapDef,
  type MoveKind,
  type PlayerId,
  type Squad,
} from '../../engine';
import { Button, Panel, Row, Stepper, Swatch, T, Title } from '../components';
import { describeLog, fmtAp, plural, type NewsItem } from '../describe';
import { Icon } from '../icons';
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

const MOVE_TITLE: Record<MoveKind, string> = {
  march: 'Переход',
  embark: 'Посадка на корабли',
  sail: 'Плавание флота',
  land: 'Высадка',
  attack: 'Атака',
  naval: 'Морской бой',
};

/** Не больше cap солдат всего: сначала пехота, потом кавалерия и пушки. */
function fillSquad(types: (keyof Squad)[], available: Squad, cap: number): Squad {
  const out: Squad = { inf: 0, cav: 0, art: 0 };
  let left = cap;
  for (const t of types) {
    out[t] = Math.max(0, Math.min(available[t], left));
    left -= out[t];
  }
  return out;
}

/** Выбор войск для приказа на перемещение: по типам, только те, что дойдут. */
export function MoveDialog({
  map,
  from,
  to,
  kind,
  steps,
  available,
  goldLeft,
  onConfirm,
  onCancel,
}: {
  map: MapDef;
  from: CellId;
  to: CellId;
  kind: MoveKind;
  steps: number;
  available: Squad;
  goldLeft: number;
  onConfirm: (squad: Squad) => void;
  onCancel: () => void;
}) {
  const { s } = useLayout();
  const M = CONFIG.move;
  const U = CONFIG.units;
  const embark = kind === 'embark' || (kind === 'naval' && map.cells[from].kind === 'land');
  // По суше у каждого типа своя дальность; флот везёт всех.
  const fromLand = map.cells[from].kind === 'land';
  const present = UNIT_TYPES.filter((t) => available[t] > 0);
  const types = present.filter((t) => !fromLand || U[t].range >= steps);
  const tooSlow = present.filter((t) => !types.includes(t));
  // На корабли — сколько хватает золота.
  const cap = embark ? Math.floor(goldLeft / M.embarkGoldPerSoldier) : Infinity;
  const [counts, setCounts] = useState<Squad>(() => fillSquad(types, available, cap));
  const count = squadSize(counts);
  const max = Math.min(cap, types.reduce((sum, t) => sum + available[t], 0));
  const maxOf = (t: keyof Squad) => Math.min(available[t], cap - (count - counts[t]));
  const cost = [`${fmtAp(M.ap)} ОД`, embark ? `${count * M.embarkGoldPerSoldier} зол.` : null].filter(Boolean).join(' · ');
  const note: Record<MoveKind, string> = {
    march: `По своей земле: ${steps} ${plural(steps, 'клетка', 'клетки', 'клеток')}. Армия сразу будет на месте.`,
    embark: `${M.embarkGoldPerSoldier} зол. за солдата. В море сила ×0,5, содержание вдвое дороже; флот ходит до ${M.seaRange} клеток.`,
    sail: `По морю: ${steps} ${plural(steps, 'клетка', 'клетки', 'клеток')}.`,
    land: 'Армия сходит на берег в своей провинции.',
    attack: 'Армия встанет у границы, бой будет после «Готово». Ничья — в пользу защиты.',
    naval: 'Бой с вражеским флотом после «Готово». В море сила ×0,5.',
  };
  return (
    <Overlay onDismiss={onCancel}>
      <Title size={20}>{MOVE_TITLE[kind]}</Title>
      <T dim size={14} style={{ marginTop: 4 * s }}>
        {map.cells[from].name} → {map.cells[to].name}
      </T>
      <T dim size={12} style={{ marginTop: 4 * s }}>
        {note[kind]}
      </T>
      <T size={13} style={{ marginTop: 6 * s, color: COLORS.goldLight }}>
        Цена: {cost}
      </T>
      {tooSlow.length > 0 && (
        <T dim size={12} style={{ marginTop: 4 * s }}>
          Не дойдут: {tooSlow.map((t) => `${U[t].label.toLowerCase()} (до ${U[t].range} кл.)`).join(', ')}
        </T>
      )}
      {max <= 0 ? (
        <T size={14} style={{ marginVertical: 16 * s, textAlign: 'center', color: COLORS.danger }}>
          {types.length === 0 ? 'Эти войска сюда за ход не дойдут' : 'Не хватает золота на корабли'}
        </T>
      ) : (
        <View style={{ alignItems: 'center', marginVertical: 12 * s, gap: 8 * s }}>
          {types.map((t) => (
            <View key={t} style={{ alignItems: 'center', gap: 2 * s }}>
              {types.length > 1 || t !== 'inf' ? (
                <T dim size={12}>
                  {U[t].label}: {counts[t]} из {available[t]}
                </T>
              ) : null}
              <Stepper
                value={counts[t]}
                min={types.length > 1 ? 0 : 1}
                max={Math.max(0, maxOf(t))}
                big={10}
                onChange={(v) => setCounts((c) => ({ ...c, [t]: v }))}
              />
            </View>
          ))}
          <Row gap={8}>
            <Button small label="Половина" onPress={() => setCounts(fillSquad(types, { inf: Math.ceil(available.inf / 2), cav: Math.ceil(available.cav / 2), art: Math.ceil(available.art / 2) }, Math.max(1, Math.floor(max / 2))))} />
            <Button small label={`Все (${max})`} onPress={() => setCounts(fillSquad(types, available, cap))} />
          </Row>
        </View>
      )}
      <Row gap={10}>
        <Button label="Отмена" onPress={onCancel} style={{ flex: 1 }} />
        <Button label="Отправить" variant="primary" icon="move" disabled={count <= 0} onPress={() => onConfirm(counts)} style={{ flex: 1 }} />
      </Row>
    </Overlay>
  );
}

/** Налог — одна ставка на всю страну, 0–90% с шагом 10%. */
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
  // Этот ход платит по действующему налогу; выбранный — со следующего хода.
  const current = game.players[player].tax;
  const now = previewEconomy(game, map, player, current);
  const later = forecastIncome(game, map, player, tax);
  const partners = tradePartners(game, map, player);
  const weary = warWeariness(game, player);
  const E = CONFIG.economy;
  return (
    <Overlay onDismiss={onCancel}>
      <Title size={20}>Налог</Title>
      <T dim size={13} style={{ marginTop: 4 * s }}>
        Новый налог начнёт приносить доход со следующего хода, а счастье потянется к его цели уже в конце этого хода. Счастье растёт
        на {E.happinessStep} пунктов за ход, а падает быстрее. Ниже {CONFIG.revolt.below}% возможны восстания: провинция может стать
        ничейной.
      </T>
      <View style={{ alignItems: 'center', marginVertical: 14 * s }}>
        <Stepper value={tax} min={E.taxMin} max={E.taxMax} step={E.taxStep} big={50} format={(v) => `${v}%`} onChange={editable ? setTax : () => {}} />
      </View>
      <View style={{ gap: 4 * s, marginBottom: 14 * s }}>
        <T>
          Цель счастья: {Math.round(targetHappiness(game, player, tax))}%{weary > 0 ? ` (усталость от войны −${weary})` : ''}
        </T>
        <T>Доход со следующего хода: ≈ +{later}</T>
        <T dim size={13}>
          В этом ходу — налог {current}%: доход +{now.income}, содержание армии −{now.upkeep}
        </T>
        <T dim size={13}>
          Торговля: {partners.length > 0 ? `+${Math.round(Math.min(CONFIG.economy.tradeMax, partners.length * CONFIG.economy.tradePerPartner) * 100)}% к доходу (${partners.map((p) => game.players[p].name).join(', ')})` : 'нет мирных соседей'}
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

/** Важное в начале хода: объявления войны и восстания. Закрывается кнопкой «ОК». */
export function NewsDialog({ war, items, onClose }: { war: boolean; items: NewsItem[]; onClose: () => void }) {
  const { s } = useLayout();
  return (
    <Overlay onDismiss={onClose} maxWidth={420}>
      <View style={{ alignItems: 'center', gap: 6 * s }}>
        {war ? <Icon name="swords" size={40 * s} color={COLORS.danger} /> : null}
        <Title size={22}>{war ? 'Вам объявили войну!' : 'Новости'}</Title>
      </View>
      <View style={{ gap: 8 * s, marginVertical: 14 * s }}>
        {items.map((it, i) => (
          <T key={i} size={15} style={{ color: it.bad ? '#FFB4A6' : COLORS.text, textAlign: 'center' }}>
            {it.text}
          </T>
        ))}
      </View>
      <Button label="ОК" variant="primary" onPress={onClose} />
    </Overlay>
  );
}

/** Короткий журнал хода: бои, захваты, доход. */
export function LogDialog({
  game,
  map,
  viewer,
  visible,
  onClose,
}: {
  game: GameState;
  map: MapDef;
  viewer: PlayerId | null;
  visible?: ReadonlySet<CellId> | null;
  onClose: () => void;
}) {
  const { s } = useLayout();
  const lines = describeLog(game, map, viewer, visible ?? null);
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

/** Другая страна предлагает мир: принять (мир — в этом ходу) или отклонить. */
export function PeaceOfferDialog({ from, onAccept, onReject }: { from: string; onAccept: () => void; onReject: () => void }) {
  const { s } = useLayout();
  return (
    <Overlay onDismiss={onReject} maxWidth={400}>
      <Title size={22} style={{ textAlign: 'center' }}>
        Предложение мира
      </Title>
      <T style={{ textAlign: 'center', marginTop: 8 * s }}>«{from}» предлагает мир.</T>
      <T dim size={13} style={{ textAlign: 'center', marginTop: 6 * s }}>
        Если принять, война закончится в этом ходу: атаки на эту страну не пойдут, вернётся торговля, пропадёт усталость от
        войны. Затем {CONFIG.war.truceTurns} ходов перемирия.
      </T>
      <Row gap={10} style={{ marginTop: 16 * s }}>
        <Button label="Отклонить" onPress={onReject} style={{ flex: 1 }} />
        <Button label="Принять" variant="primary" icon="check" onPress={onAccept} style={{ flex: 1 }} />
      </Row>
    </Overlay>
  );
}

/** «Завершить ход?» — чтобы не нажать «Готово» случайно. */
export function EndTurnDialog({ apLeft, onNo, onYes }: { apLeft: number; onNo: () => void; onYes: () => void }) {
  const { s } = useLayout();
  return (
    <Overlay onDismiss={onNo} maxWidth={360}>
      <Title size={22} style={{ textAlign: 'center' }}>
        Завершить ход?
      </Title>
      {apLeft > 0 && (
        <T dim style={{ textAlign: 'center', marginTop: 6 * s }}>
          Не потрачено {fmtAp(apLeft)} ОД
        </T>
      )}
      <Row gap={10} style={{ marginTop: 16 * s }}>
        <Button label="Нет" onPress={onNo} style={{ flex: 1 }} />
        <Button label="Да" variant="primary" icon="check" onPress={onYes} style={{ flex: 1 }} />
      </Row>
    </Overlay>
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
