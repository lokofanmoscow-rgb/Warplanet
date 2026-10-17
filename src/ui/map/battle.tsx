import React, { useEffect, useMemo } from 'react';
import { Atlas, Circle, Group, Path, Skia, Text, type SkFont, type SkImage } from '@shopify/react-native-skia';
import { Easing, useDerivedValue, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import type { CellId, GameState, MapDef, PlayerId, TurnEvent } from '../../engine';
import type { MapGeometry } from './geometry';
import { fillColor } from './layers';
import { borderPos, frameRect, homePos, plateY, UNIT_PX, UnitPlate, type UnitPos } from './units';

// Показ боёв после «Готово»: камера на клетку, армия подходит, схватка с убывающими числами, итог.

/** Длительность показа одного боя и момент, когда объявляется итог, мс. */
export const BATTLE_MS = 3400;
export const RESULT_AT = 2500;
const APPROACH = 0.2;
const FIGHT_END = RESULT_AT / BATTLE_MS;

export interface BattleView {
  cell: CellId;
  attacker: PlayerId;
  defender: PlayerId | null;
  attack: number;
  defense: number;
  attackerLeft: number;
  defenderLeft: number;
  winner: PlayerId | null;
  /** Откуда входит атакующий. */
  from: CellId | null;
  /** Защитник тоже пришёл в этом ходу (бой атакующих между собой или встречный бой). */
  defFrom: CellId | null;
  border: boolean;
  /** Чья клетка до боя и после него. */
  ownerBefore: PlayerId | null;
  ownerAfter: PlayerId | null;
}

/** Бои хода с участием игроков этого устройства, по порядку. */
export function battlesFor(log: TurnEvent[], game: GameState, map: MapDef, viewers: PlayerId[]): BattleView[] {
  const out: BattleView[] = [];
  // Владелец клетки до первого захвата в этом ходу — по событиям захвата.
  const owner = new Map<CellId, PlayerId | null>();
  for (const e of log) if (e.t === 'capture' && !owner.has(e.cell)) owner.set(e.cell, e.from);
  const cur = (cell: CellId) => (owner.has(cell) ? owner.get(cell)! : game.cells[cell].owner);
  log.forEach((e) => {
    if (e.t === 'capture') {
      owner.set(e.cell, e.player);
      const last = [...out].reverse().find((b) => b.cell === e.cell);
      if (last) last.ownerAfter = e.player;
      return;
    }
    if (e.t !== 'battle') return;
    const sea = map.cells[e.cell].kind === 'sea';
    const before = sea ? null : cur(e.cell);
    if (!viewers.includes(e.attacker) && !(e.defender !== null && viewers.includes(e.defender))) return;
    out.push({
      cell: e.cell,
      attacker: e.attacker,
      defender: e.defender,
      attack: e.attack,
      defense: e.defense,
      attackerLeft: e.attackerLeft,
      defenderLeft: e.defenderLeft,
      winner: e.winner,
      from: e.from ?? e.fromCells?.[0] ?? null,
      defFrom: e.border ? e.cell : (e.defFromCells?.[0] ?? null),
      border: !!e.border,
      ownerBefore: before,
      ownerAfter: before,
    });
  });
  return out;
}

/** Текст итога для игроков этого устройства (на одном телефоне вдвоём — нейтрально, по именам). */
export function battleResult(
  b: BattleView,
  map: MapDef,
  viewers: PlayerId[],
  nameOf: (p: PlayerId | null) => string,
): { text: string; good: boolean } {
  const name = map.cells[b.cell].name;
  const captured = b.ownerAfter !== b.ownerBefore && b.ownerAfter !== null;
  const iAttack = viewers.includes(b.attacker);
  const iDefend = b.defender !== null && viewers.includes(b.defender);
  if (iAttack && iDefend) {
    if (b.winner === null) return { text: 'Обе армии разбиты', good: false };
    return { text: captured ? `${nameOf(b.winner)}: ${name} захвачена` : `Победа: ${nameOf(b.winner)}`, good: true };
  }
  const won = b.winner !== null && viewers.includes(b.winner);
  if (iAttack) {
    if (won && captured) return { text: `Победа! ${name} — ваша`, good: true };
    if (won) return { text: `Победа у ${name}`, good: true };
    return { text: b.winner === null ? 'Обе армии разбиты' : 'Атака отбита', good: false };
  }
  if (won) return { text: `Оборона выстояла: ${name}`, good: true };
  return { text: captured ? `${name} потеряна` : 'Ваша армия разбита', good: false };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

interface Track {
  att0: UnitPos;
  att1: UnitPos;
  def0: UnitPos;
  def1: UnitPos;
}

/** Откуда и куда идут обе стороны. */
function trackFor(map: MapDef, b: BattleView, k: number): Track {
  // В бою армии крупнее обычного, чтобы схватку было хорошо видно.
  const kk = k * 1.3;
  const home = homePos(map, b.cell, kk);
  const meet = b.border && b.from !== null ? { ...home, x: (home.x + homePos(map, b.from, kk).x) / 2, y: (home.y + homePos(map, b.from, kk).y) / 2 } : home;
  const def0 =
    b.defFrom !== null && b.defFrom !== b.cell
      ? borderPos(map, b.defFrom, b.cell, kk)
      : b.border && b.from !== null
        ? borderPos(map, b.cell, b.from, kk, 0.25)
        : home;
  const def1 = def0 === home ? home : { ...def0, x: lerp(def0.x, meet.x, 0.5), y: lerp(def0.y, meet.y, 0.5) };
  const att0 = b.from !== null ? borderPos(map, b.from, b.cell, kk, b.border ? 0.25 : 0.45) : { ...home, x: home.x - home.size * 1.6 };
  // Сходятся бок о бок: атакующий встаёт слева или справа от защитника, лицом к нему.
  const side = att0.x <= def1.x ? -1 : 1;
  const gap = home.size * 0.85;
  const att1 = { ...att0, x: def1.x + side * gap, y: def1.y + Math.max(-0.2, Math.min(0.2, (att0.y - def1.y) / home.size)) * home.size, faceLeft: side > 0 };
  return {
    att0: { ...att0, faceLeft: side > 0 },
    att1,
    def0: { ...def0, faceLeft: side < 0 },
    def1: { ...def1, faceLeft: side < 0 },
  };
}

/** Клетки, где бой ещё не показан: здесь пока видна старая граница. */
export function PendingFills({
  geo,
  game,
  battles,
  index,
  t,
}: {
  geo: MapGeometry;
  game: GameState;
  battles: BattleView[];
  index: number;
  t: SharedValue<number>;
}) {
  const fills = useMemo(() => {
    const seen = new Set<CellId>();
    const out: { cell: CellId; color: string; current: boolean }[] = [];
    battles.forEach((b, i) => {
      if (i < index || seen.has(b.cell) || geo.map.cells[b.cell].kind === 'sea') return;
      seen.add(b.cell);
      if (b.ownerBefore === game.cells[b.cell].owner) return;
      // Текущий бой — последний в этой клетке? Тогда к концу показа старая граница тает.
      const lastHere = !battles.some((x, j) => j > i && x.cell === b.cell);
      out.push({
        cell: b.cell,
        color: fillColor(b.ownerBefore, game),
        current: i === index && lastHere,
      });
    });
    return out;
  }, [geo, game, battles, index]);
  const fade = useDerivedValue(() => (t.value < 0.86 ? 1 : Math.max(0, (1 - t.value) / 0.14)));
  return (
    <Group>
      {fills.map((f) => (
        <Path key={f.cell} path={geo.cellPaths[f.cell]} color={f.color} opacity={f.current ? fade : 1} />
      ))}
    </Group>
  );
}

/** Сам бой: две армии сходятся, стреляют, числа убывают, проигравший исчезает. */
export function BattleScene({
  map,
  game,
  battle,
  atlas,
  font,
  k,
  t,
}: {
  map: MapDef;
  game: GameState;
  battle: BattleView;
  atlas: SkImage | null;
  font: SkFont | null;
  k: number;
  t: SharedValue<number>;
}) {
  const tr = useMemo(() => trackFor(map, battle, k), [map, battle, k]);
  const color = (p: PlayerId | null) => (p !== null ? (game.players[p]?.color ?? null) : null);
  const attColor = color(battle.attacker);
  const defColor = color(battle.defender);
  const size = tr.att0.size;
  const s = size / UNIT_PX;
  const attWon = battle.winner === battle.attacker;
  const defWon = battle.winner !== null && battle.winner === battle.defender;
  // Кадры: [покой, бой] для каждой стороны.
  const attFrames = [
    frameRect(attColor, tr.att1.ship, false, tr.att1.faceLeft),
    frameRect(attColor, tr.att1.ship, true, tr.att1.faceLeft),
  ].map((r) => [r.x, r.y]);
  const defFrames = [
    frameRect(defColor, tr.def1.ship, false, tr.def1.faceLeft),
    frameRect(defColor, tr.def1.ship, true, tr.def1.faceLeft),
  ].map((r) => [r.x, r.y]);
  const P = {
    ax0: tr.att0.x,
    ay0: tr.att0.y,
    ax1: tr.att1.x,
    ay1: tr.att1.y,
    dx0: tr.def0.x,
    dy0: tr.def0.y,
    dx1: tr.def1.x,
    dy1: tr.def1.y,
  };

  const pos = (side: 'a' | 'd') => {
    'worklet';
    const go = Math.min(1, t.value / APPROACH);
    const e = 1 - (1 - go) * (1 - go);
    const fighting = t.value > APPROACH && t.value < FIGHT_END;
    // В схватке армии чуть дёргаются.
    const jig = fighting ? Math.sin(t.value * 90 + (side === 'a' ? 0 : 1.7)) * 1.6 * k : 0;
    return side === 'a'
      ? [P.ax0 + (P.ax1 - P.ax0) * e + jig, P.ay0 + (P.ay1 - P.ay0) * e]
      : [P.dx0 + (P.dx1 - P.dx0) * e - jig, P.dy0 + (P.dy1 - P.dy0) * e];
  };
  const shooting = (side: 'a' | 'd') => {
    'worklet';
    if (t.value <= APPROACH || t.value >= FIGHT_END) return false;
    return Math.floor(t.value * 26 + (side === 'a' ? 0 : 0.5)) % 2 === 0;
  };
  const xform = (side: 'a' | 'd') => {
    'worklet';
    const [x, y] = pos(side);
    return [Skia.RSXform(s, 0, x - size / 2, y - size * 0.93)];
  };
  const frame = (side: 'a' | 'd') => {
    'worklet';
    const f = (side === 'a' ? attFrames : defFrames)[shooting(side) ? 1 : 0];
    return [Skia.XYWHRect(f[0], f[1], UNIT_PX, UNIT_PX)];
  };
  const attXform = useDerivedValue(() => xform('a'));
  const defXform = useDerivedValue(() => xform('d'));
  const attSprite = useDerivedValue(() => frame('a'));
  const defSprite = useDerivedValue(() => frame('d'));
  // Проигравший тает после схватки.
  const lose = () => {
    'worklet';
    return t.value < FIGHT_END ? 1 : Math.max(0, 1 - (t.value - FIGHT_END) / 0.1);
  };
  const attOpacity = useDerivedValue(() => (attWon ? 1 : lose()));
  const defOpacity = useDerivedValue(() => (defWon ? 1 : lose()));

  const count = (from: number, to: number) => {
    'worklet';
    const f = Math.max(0, Math.min(1, (t.value - APPROACH) / (FIGHT_END - APPROACH)));
    const e = 1 - (1 - f) * (1 - f);
    return `${Math.round(from + (to - from) * e)}`;
  };
  const attText = useDerivedValue(() => count(battle.attack, battle.attackerLeft));
  const defText = useDerivedValue(() => count(battle.defense, battle.defenderLeft));
  const attPlate = useDerivedValue(() => {
    const [x, y] = pos('a');
    return [{ translateX: x }, { translateY: y }];
  });
  const defPlate = useDerivedValue(() => {
    const [x, y] = pos('d');
    return [{ translateX: x }, { translateY: y }];
  });

  // Дым и вспышки между армиями.
  const mid = { x: (P.ax1 + P.dx1) / 2, y: (P.ay1 + P.dy1) / 2 - size * 0.35 };
  const smoke = [0, 1, 2, 3].map((i) => ({
    dx: (i - 1.5) * size * 0.16,
    dy: (i % 2) * size * 0.12,
    phase: i * 0.23,
  }));

  if (!atlas || !font) return null;
  const py = plateY({ x: 0, y: 0, size, ship: tr.att1.ship, faceLeft: false }, k);
  const pyDef = plateY({ x: 0, y: 0, size, ship: tr.def1.ship, faceLeft: false }, k);
  return (
    <Group>
      <Group opacity={defOpacity}>
        <Atlas image={atlas} sprites={defSprite} transforms={defXform} />
      </Group>
      <Group opacity={attOpacity}>
        <Atlas image={atlas} sprites={attSprite} transforms={attXform} />
      </Group>
      {smoke.map((p, i) => (
        <Puff key={i} x={mid.x + p.dx} y={mid.y + p.dy} r={size * 0.14} phase={p.phase} t={t} />
      ))}
      <Group transform={defPlate} opacity={defOpacity}>
        <PlateText y={pyDef} text={defText} color={defColor} font={font} k={k} />
      </Group>
      <Group transform={attPlate} opacity={attOpacity}>
        <PlateText y={py} text={attText} color={attColor} font={font} k={k} />
      </Group>
    </Group>
  );
}

/** Клуб дыма с вспышкой — пульсирует, пока идёт схватка. */
function Puff({ x, y, r, phase, t }: { x: number; y: number; r: number; phase: number; t: SharedValue<number> }) {
  const live = () => {
    'worklet';
    if (t.value <= APPROACH || t.value >= FIGHT_END + 0.05) return -1;
    return (t.value * 5 + phase) % 1;
  };
  const radius = useDerivedValue(() => {
    const p = live();
    return p < 0 ? 0 : r * (0.5 + p * 0.9);
  });
  const opacity = useDerivedValue(() => {
    const p = live();
    return p < 0 ? 0 : 0.75 * (1 - p);
  });
  const flash = useDerivedValue(() => {
    const p = live();
    return p < 0 || p > 0.25 ? 0 : r * 0.45;
  });
  return (
    <Group>
      <Circle cx={x} cy={y} r={radius} color="#EDE8DC" opacity={opacity} />
      <Circle cx={x} cy={y} r={flash} color="#FFD45A" />
    </Group>
  );
}

/** Плашка с числом, которое меняется во время боя. */
function PlateText({ y, text, color, font, k }: { y: number; text: SharedValue<string>; color: string | null; font: SkFont; k: number }) {
  const size = font.getSize();
  const width = (font.measureText('000').width + 10) * k;
  const digit = font.measureText('0').width * k;
  const x0 = -width / 2;
  const tx = useDerivedValue(() => (width - text.value.length * digit) / 2 + x0);
  const textX = useDerivedValue(() => [{ translateX: tx.value }, { translateY: y + size * 0.36 * k }, { scale: k }]);
  return (
    <Group>
      <UnitPlate x={0} y={y} label="000" color={color} font={font} k={k} hideLabel />
      <Group transform={textX}>
        <Text x={0} y={0} text={text} font={font} color="#F5EBD7" />
      </Group>
    </Group>
  );
}

/** Часы показа боя: 0 → 1 за BATTLE_MS, заново для каждого боя (key — ход и номер боя). */
export function useBattleClock(key: string | null): SharedValue<number> {
  const t = useSharedValue(0);
  useEffect(() => {
    if (key === null) return;
    t.value = 0;
    t.value = withTiming(1, { duration: BATTLE_MS, easing: Easing.linear });
  }, [key, t]);
  return t;
}
