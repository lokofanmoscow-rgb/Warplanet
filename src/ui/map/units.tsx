import React, { useEffect, useMemo, useState } from 'react';
import {
  Atlas,
  Circle,
  Group,
  Oval,
  Path,
  Rect,
  RoundedRect,
  Skia,
  Text,
  type SkFont,
  type SkImage,
  type SkRect,
  type SkRSXform,
} from '@shopify/react-native-skia';
import { CONFIG, type CellId, type GameState, type MapDef, type PlayerId } from '../../engine';
import { COLORS, shade } from '../theme';
import { renderImage } from './offscreen';

// Армии и флоты на карте: солдатики в цвете страны и корабли, над ними плашка с числом.
// Все фигурки рисуются один раз в картинку-атлас (по строке на цвет), а на карте выводятся
// одной командой Atlas — так их может быть сколько угодно без потери плавности.

const OUTLINE = COLORS.border;
/** Сторона клетки атласа в пикселях. */
export const UNIT_PX = 96;
const NEUTRAL = '#9C8F7C';
const ROWS: string[] = [...CONFIG.players.colors, NEUTRAL];

export type UnitFrame = 'idle' | 'fight' | 'ship' | 'cav' | 'art';
const COLS: Record<UnitFrame, number> = { idle: 0, fight: 1, ship: 2, cav: 3, art: 4 };
// Те же кадры, отражённые (смотрят влево), — в колонках 5–9.
const FLIP_OFFSET = 5;

function poly(points: number[]) {
  const b = Skia.PathBuilder.Make();
  b.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) b.lineTo(points[i], points[i + 1]);
  b.close();
  return b.build();
}

/** Солдатик: (x, y) — точка между ступнями, рост около 48 пикселей при s = 1. */
function Soldier({ x, y, s, color, fight }: { x: number; y: number; s: number; color: string; fight: boolean }) {
  const dark = shade(color, -0.38);
  const light = shade(color, 0.18);
  const sw = 1.5 * s;
  const u = (v: number) => v * s;
  const torso = poly([x - u(8), y - u(31), x + u(8), y - u(31), x + u(7), y - u(14), x - u(7), y - u(14)]);
  const torsoShade = poly([x + u(1), y - u(31), x + u(8), y - u(31), x + u(7), y - u(14), x + u(1), y - u(14)]);
  const helmet = Skia.PathBuilder.Make()
    .addArc({ x: x - u(7.5), y: y - u(45), width: u(15), height: u(15) }, 180, 180)
    .close()
    .build();
  // Винтовка: на плече или наперевес вперёд.
  const rifle = fight
    ? { x1: x - u(4), y1: y - u(22), x2: x + u(24), y2: y - u(25) }
    : { x1: x + u(8), y1: y - u(12), x2: x + u(4), y2: y - u(47) };
  return (
    <Group>
      <Oval x={x - u(11)} y={y - u(3.5)} width={u(22)} height={u(7)} color="rgba(0,0,0,0.28)" />
      {/* ноги и сапоги */}
      <Rect x={x - u(6)} y={y - u(15)} width={u(5)} height={u(13)} color="#4A3B2C" />
      <Rect x={x + u(1)} y={y - u(15)} width={u(5)} height={u(13)} color="#3A2E22" />
      <RoundedRect x={x - u(7)} y={y - u(4)} width={u(6.5)} height={u(4)} r={u(1.5)} color="#22190F" />
      <RoundedRect x={x + u(0.5)} y={y - u(4)} width={u(6.5)} height={u(4)} r={u(1.5)} color="#22190F" />
      {/* мундир */}
      <Path path={torso} color={color} />
      <Path path={torsoShade} color={dark} opacity={0.55} />
      <Rect x={x - u(7.5)} y={y - u(18)} width={u(15)} height={u(2.6)} color="#3B2A1A" />
      <Rect x={x - u(1)} y={y - u(30)} width={u(2)} height={u(12)} color={light} opacity={0.5} />
      <Path path={torso} color={OUTLINE} style="stroke" strokeWidth={sw} />
      {/* винтовка */}
      <Path
        path={Skia.PathBuilder.Make().moveTo(rifle.x1, rifle.y1).lineTo(rifle.x2, rifle.y2).build()}
        color="#5B3F27"
        style="stroke"
        strokeWidth={u(2.6)}
        strokeCap="round"
      />
      <Circle cx={rifle.x2} cy={rifle.y2} r={u(1.3)} color="#C9C4BA" />
      {fight && <Path path={poly(flash(rifle.x2 + u(4), rifle.y2, u(5)))} color="#FFD45A" />}
      {/* рука */}
      <RoundedRect x={x + (fight ? u(2) : u(5))} y={y - u(29)} width={u(5)} height={u(12)} r={u(2.5)} color={dark} />
      {/* голова и каска */}
      <Circle cx={x} cy={y - u(36)} r={u(6)} color="#EFC59C" />
      <Circle cx={x} cy={y - u(36)} r={u(6)} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={helmet} color={dark} />
      <Rect x={x - u(9)} y={y - u(38.5)} width={u(18)} height={u(2.6)} color={shade(color, -0.55)} />
      <Path path={helmet} color={OUTLINE} style="stroke" strokeWidth={sw} />
    </Group>
  );
}

function flash(x: number, y: number, r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI * 2 * i) / 10;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  return pts;
}

/** Отряд из трёх солдат в клетке 96×96 (ступни переднего — у нижнего края). */
export function SoldierGroup({ color, fight }: { color: string; fight: boolean }) {
  return (
    <Group>
      <Soldier x={30} y={70} s={0.82} color={color} fight={fight} />
      <Soldier x={62} y={68} s={0.82} color={color} fight={fight} />
      <Soldier x={44} y={90} s={1} color={color} fight={fight} />
    </Group>
  );
}

/** Парусник в клетке 96×96, ватерлиния около y = 80. */
function Ship({ color }: { color: string }) {
  const hull = poly([8, 60, 88, 60, 78, 80, 20, 80]);
  const band = poly([12, 70, 84, 70, 78, 80, 20, 80]);
  const sail = Skia.PathBuilder.Make().moveTo(50, 20).quadTo(80, 30, 76, 56).lineTo(50, 56).close().build();
  const jib = poly([45, 24, 45, 54, 22, 54]);
  const stripe = Skia.PathBuilder.Make().moveTo(50, 36).quadTo(78, 40, 78, 44).lineTo(50, 44).close().build();
  const flag = poly([50, 8, 70, 12, 50, 17]);
  const sw = 1.6;
  return (
    <Group>
      <Oval x={10} y={76} width={78} height={12} color="rgba(0,0,0,0.25)" />
      <Path
        path={Skia.PathBuilder.Make().moveTo(6, 82).quadTo(12, 78, 18, 82).moveTo(78, 82).quadTo(84, 78, 90, 82).build()}
        color="#E8F2F7"
        style="stroke"
        strokeWidth={2.2}
        strokeCap="round"
      />
      <Rect x={47} y={8} width={3.5} height={54} color="#5A3E25" />
      <Path path={sail} color="#F5EBD7" />
      <Path path={stripe} color={color} />
      <Path path={sail} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={jib} color="#E7DCC4" />
      <Path path={jib} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={flag} color={color} />
      <Path path={flag} color={OUTLINE} style="stroke" strokeWidth={1.2} />
      <Path path={hull} color="#8A5A34" />
      <Path path={band} color="#6A4224" />
      <Rect x={14} y={60} width={68} height={3} color="#B07A48" />
      {[26, 40, 54, 68].map((cx) => (
        <Circle key={cx} cx={cx} cy={66} r={2.2} color="#2B2118" />
      ))}
      <Path path={hull} color={OUTLINE} style="stroke" strokeWidth={sw} />
    </Group>
  );
}

/** Всадник с саблей в клетке 96×96 (копыта у нижнего края). */
function Horseman({ color }: { color: string }) {
  const dark = shade(color, -0.38);
  const horse = '#7A5232';
  const horseDark = '#583820';
  const sw = 1.6;
  const neck = poly([60, 58, 70, 36, 80, 38, 72, 62]);
  const head = poly([70, 34, 88, 42, 87, 49, 74, 47]);
  const torso = poly([38, 22, 52, 22, 51, 44, 40, 44]);
  const helmet = Skia.PathBuilder.Make().addArc({ x: 38.5, y: 7, width: 13, height: 13 }, 180, 180).close().build();
  const tail = Skia.PathBuilder.Make().moveTo(20, 56).quadTo(8, 62, 10, 78).build();
  return (
    <Group>
      <Oval x={14} y={84} width={68} height={8} color="rgba(0,0,0,0.28)" />
      <Path path={tail} color={horseDark} style="stroke" strokeWidth={5} strokeCap="round" />
      {/* дальние ноги темнее */}
      <Rect x={27} y={64} width={5} height={22} color={horseDark} />
      <Rect x={58} y={64} width={5} height={22} color={horseDark} />
      <Oval x={16} y={46} width={56} height={24} color={horse} />
      <Rect x={20} y={64} width={5.5} height={23} color={horse} />
      <Rect x={64} y={64} width={5.5} height={23} color={horse} />
      {[19.5, 26.5, 57.5, 63.5].map((x) => (
        <Rect key={x} x={x} y={85} width={6.5} height={3.5} color="#22190F" />
      ))}
      <Path path={neck} color={horse} />
      <Path path={head} color={horse} />
      <Path
        path={Skia.PathBuilder.Make().moveTo(62, 56).lineTo(70, 37).build()}
        color={horseDark}
        style="stroke"
        strokeWidth={3}
        strokeCap="round"
      />
      <Circle cx={80} cy={42} r={1.4} color="#1B130C" />
      <Oval x={16} y={46} width={56} height={24} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={head} color={OUTLINE} style="stroke" strokeWidth={sw} />
      {/* чепрак в цвет страны */}
      <RoundedRect x={34} y={44} width={22} height={13} r={3} color={color} />
      <RoundedRect x={34} y={44} width={22} height={13} r={3} color={OUTLINE} style="stroke" strokeWidth={1.2} />
      {/* всадник */}
      <Rect x={41} y={42} width={5} height={14} color="#3A2E22" />
      <Path path={torso} color={color} />
      <Path path={poly([45, 22, 52, 22, 51, 44, 45, 44])} color={dark} opacity={0.55} />
      <Path path={torso} color={OUTLINE} style="stroke" strokeWidth={sw} />
      {/* сабля над головой */}
      <Path
        path={Skia.PathBuilder.Make().moveTo(52, 30).quadTo(64, 18, 70, 6).build()}
        color="#D9D4CA"
        style="stroke"
        strokeWidth={2.6}
        strokeCap="round"
      />
      <RoundedRect x={49} y={26} width={5} height={11} r={2.5} color={dark} />
      <Circle cx={45} cy={16} r={5.5} color="#EFC59C" />
      <Circle cx={45} cy={16} r={5.5} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={helmet} color={dark} />
      <Rect x={37} y={12} width={16} height={2.4} color={shade(color, -0.55)} />
      <Path path={helmet} color={OUTLINE} style="stroke" strokeWidth={sw} />
    </Group>
  );
}

/** Пушка на лафете в клетке 96×96 (колесо стоит у нижнего края). */
function Cannon({ color }: { color: string }) {
  const barrel = poly([30, 50, 84, 34, 87, 43, 34, 60]);
  const carriage = poly([20, 62, 58, 50, 62, 66, 24, 76]);
  const wood = '#6B4A2B';
  const sw = 1.6;
  return (
    <Group>
      <Oval x={6} y={82} width={78} height={9} color="rgba(0,0,0,0.28)" />
      <Path
        path={Skia.PathBuilder.Make().moveTo(26, 70).lineTo(8, 86).build()}
        color={wood}
        style="stroke"
        strokeWidth={6}
        strokeCap="round"
      />
      <Path path={carriage} color={wood} />
      <Path path={poly([22, 66, 60, 56, 61, 61, 23, 71])} color={color} />
      <Path path={carriage} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={barrel} color="#3D3C40" />
      <Path path={poly([32, 52, 84, 37, 85, 40, 33, 55])} color="#6C6A70" />
      <Path path={barrel} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <RoundedRect x={82} y={33} width={6} height={11} r={2} color="#2A292C" />
      {/* колесо со спицами */}
      <Circle cx={46} cy={72} r={15} color={wood} style="stroke" strokeWidth={4.5} />
      {[0, 45, 90, 135].map((a) => {
        const r = (a * Math.PI) / 180;
        return (
          <Path
            key={a}
            path={Skia.PathBuilder.Make()
              .moveTo(46 - Math.cos(r) * 13, 72 - Math.sin(r) * 13)
              .lineTo(46 + Math.cos(r) * 13, 72 + Math.sin(r) * 13)
              .build()}
            color="#5A3E25"
            style="stroke"
            strokeWidth={2}
          />
        );
      })}
      <Circle cx={46} cy={72} r={17.2} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Circle cx={46} cy={72} r={3.5} color="#2B2118" />
    </Group>
  );
}

function Frame({ frame, color }: { frame: UnitFrame; color: string }) {
  if (frame === 'ship') return <Ship color={color} />;
  if (frame === 'cav') return <Horseman color={color} />;
  if (frame === 'art') return <Cannon color={color} />;
  return <SoldierGroup color={color} fight={frame === 'fight'} />;
}

const FRAMES: UnitFrame[] = ['idle', 'fight', 'ship', 'cav', 'art'];

function AtlasContent() {
  return (
    <Group>
      {ROWS.map((color, row) =>
        FRAMES.map((frame, col) => (
          <Group key={`${row}-${col}`}>
            <Group transform={[{ translateX: col * UNIT_PX }, { translateY: row * UNIT_PX }]}>
              <Frame frame={frame} color={color} />
            </Group>
            <Group transform={[{ translateX: (col + FLIP_OFFSET + 1) * UNIT_PX }, { translateY: row * UNIT_PX }, { scaleX: -1 }]}>
              <Frame frame={frame} color={color} />
            </Group>
          </Group>
        )),
      )}
    </Group>
  );
}

let atlasCache: SkImage | null = null;
let atlasPromise: Promise<SkImage | null> | null = null;

/** Атлас фигурок; null — пока рисуется или если офскрин недоступен (тогда рисуем вектором). */
export function useUnitAtlas(): { image: SkImage | null; failed: boolean } {
  const [image, setImage] = useState<SkImage | null>(atlasCache);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (atlasCache) return;
    let alive = true;
    atlasPromise ??= renderImage(<AtlasContent />, {
      width: UNIT_PX * FLIP_OFFSET * 2,
      height: UNIT_PX * ROWS.length,
    })
      .then((img) => (atlasCache = img ?? null))
      .catch(() => null);
    atlasPromise.then((img) => {
      if (!alive) return;
      if (img) setImage(img);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return { image, failed };
}

function spriteRect(color: string | null, frame: UnitFrame, faceLeft: boolean): SkRect {
  const row = Math.max(0, color ? ROWS.indexOf(color) : ROWS.length - 1);
  const col = COLS[frame] + (faceLeft ? FLIP_OFFSET : 0);
  return Skia.XYWHRect(col * UNIT_PX, row * UNIT_PX, UNIT_PX, UNIT_PX);
}

// ---------- Где стоит армия ----------

export interface UnitInfo {
  key: string;
  /** Клетка, где стоит армия; у атаки — откуда она входит в бой. */
  cell: CellId;
  owner: PlayerId | null;
  troops: number;
  /** Из них кавалерия и артиллерия — рисуются всадником и пушкой рядом с отрядом. */
  cav?: number;
  art?: number;
  /** Нанято в этом ходу (плашка с «+»). */
  recruited?: boolean;
  /** Атака в этом ходу: армия стоит на границе и смотрит на цель. */
  target?: CellId;
}

export interface UnitPos {
  /** Точка между ступнями (или ватерлиния корабля). */
  x: number;
  y: number;
  /** Сторона клетки атласа в единицах карты. */
  size: number;
  ship: boolean;
  faceLeft: boolean;
}

/** Размер фигурки в единицах карты при масштабе подписей k. */
export function unitSize(k: number): number {
  return 52 * k;
}

/** Место армии в клетке: справа от города на суше, в центре моря — флот. */
export function homePos(map: MapDef, cell: CellId, k: number): UnitPos {
  const c = map.cells[cell];
  const size = unitSize(k);
  if (c.kind === 'sea')
    return {
      x: c.center[0],
      y: c.center[1] + size * 0.32,
      size,
      ship: true,
      faceLeft: false,
    };
  return {
    x: c.center[0] + 18 + size * 0.28,
    y: c.center[1] + 14,
    size,
    ship: false,
    faceLeft: false,
  };
}

/** Армия, идущая в атаку: на границе между своей клеткой и целью, лицом к цели. */
export function borderPos(map: MapDef, from: CellId, to: CellId, k: number, t = 0.45): UnitPos {
  const home = homePos(map, from, k);
  const [tx, ty] = map.cells[to].center;
  return {
    ...home,
    x: home.x + (tx - home.x) * t,
    y: home.y + (ty + 12 - home.y) * t,
    faceLeft: tx < home.x,
  };
}

export function unitPos(map: MapDef, u: UnitInfo, k: number): UnitPos {
  return u.target !== undefined ? borderPos(map, u.cell, u.target, k) : homePos(map, u.cell, k);
}

/** Точка захвата пальцем: середина между плашкой и фигуркой. */
export function grabPoint(map: MapDef, cell: CellId, k: number): [number, number] {
  const p = homePos(map, cell, k);
  return [p.x, p.y - p.size * 0.55];
}

export function frameRect(color: string | null, ship: boolean, fight: boolean, faceLeft: boolean): SkRect {
  return spriteRect(color, ship ? 'ship' : fight ? 'fight' : 'idle', faceLeft);
}

/**
 * Фигурки армии на суше: главная — пехота (если есть), рядом поменьше — всадник и пушка.
 * dx, dy — сдвиг от места армии в долях размера, scale — масштаб.
 */
export function figuresOf(u: UnitInfo, ship: boolean): { frame: UnitFrame; dx: number; dy: number; scale: number }[] {
  if (ship) return [{ frame: 'ship', dx: 0, dy: 0, scale: 1 }];
  const cav = u.cav ?? 0;
  const art = u.art ?? 0;
  const inf = u.troops - cav - art;
  const main: UnitFrame = inf > 0 ? (u.target !== undefined ? 'fight' : 'idle') : cav > 0 ? 'cav' : 'art';
  const out = [{ frame: main, dx: 0, dy: 0, scale: 1 }];
  if (cav > 0 && main !== 'cav') out.unshift({ frame: 'cav', dx: -0.5, dy: -0.06, scale: 0.8 });
  if (art > 0 && main !== 'art') out.push({ frame: 'art', dx: 0.48, dy: 0.04, scale: 0.72 });
  return out;
}

function shifted(p: UnitPos, f: { dx: number; dy: number; scale: number }): UnitPos {
  const dir = p.faceLeft ? -1 : 1;
  return { ...p, x: p.x + f.dx * p.size * dir, y: p.y + f.dy * p.size, size: p.size * f.scale };
}

export function frameXform(p: UnitPos): SkRSXform {
  const s = p.size / UNIT_PX;
  // Фигурка в клетке атласа: ступни у нижнего края по центру.
  return Skia.RSXform(s, 0, p.x - p.size / 2, p.y - p.size * 0.93);
}

// ---------- Слой армий ----------

/** Плашка с числом над армией. */
export function UnitPlate({
  x,
  y,
  label,
  color,
  font,
  k,
  hideLabel,
}: {
  x: number;
  y: number;
  label: string;
  color: string | null;
  font: SkFont;
  k: number;
  /** Только подложка: число рисуется отдельно (меняется во время боя). */
  hideLabel?: boolean;
}) {
  const size = font.getSize();
  const h = 15 * k;
  const tw = font.measureText(label).width;
  const width = (tw + 10) * k;
  const x0 = x - width / 2;
  return (
    <Group>
      <RoundedRect x={x0 + 1.2 * k} y={y - h / 2 + 1.6 * k} width={width} height={h} r={3.5 * k} color="rgba(0,0,0,0.3)" />
      <RoundedRect x={x0} y={y - h / 2} width={width} height={h} r={3.5 * k} color={color ? COLORS.panel : '#5B5145'} />
      <RoundedRect
        x={x0}
        y={y - h / 2}
        width={width}
        height={h}
        r={3.5 * k}
        color={color ?? '#A39885'}
        style="stroke"
        strokeWidth={2 * k}
      />
      {!hideLabel && (
        <Group transform={[{ translateX: x0 + 5 * k }, { translateY: y + size * 0.36 * k }, { scale: k }]}>
          <Text x={0} y={0} text={label} font={font} color={color ? COLORS.text : '#EDE3CF'} />
        </Group>
      )}
    </Group>
  );
}

/** Центр плашки — сразу над касками (или над флагом корабля). */
export function plateY(p: UnitPos, k: number): number {
  return p.ship ? p.y - p.size * 0.85 - 6 * k : p.y - p.size * 0.62 - 9 * k;
}

export const UnitLayer = React.memo(function UnitLayer({
  map,
  game,
  units,
  font,
  k,
  atlas,
  hidden,
}: {
  map: MapDef;
  game: GameState;
  units: UnitInfo[];
  font: SkFont | null;
  k: number;
  atlas: { image: SkImage | null; failed: boolean };
  /** Клетки, где армии сейчас не показываются (там идёт бой). */
  hidden?: ReadonlySet<CellId>;
}) {
  const colorOf = (owner: PlayerId | null) => (owner !== null ? (game.players[owner]?.color ?? null) : null);
  const shown = useMemo(
    () =>
      units.filter(
        (u) => u.troops > 0 && !(hidden?.has(u.cell) && u.target === undefined) && !(u.target !== undefined && hidden?.has(u.target)),
      ),
    [units, hidden],
  );
  // Нейтральное ополчение — только плашка, у стран — фигурки (пехота, всадник, пушка).
  const figures = useMemo(
    () =>
      shown
        .filter((u) => u.owner !== null)
        .flatMap((u) => {
          const p = unitPos(map, u, k);
          return figuresOf(u, p.ship).map((f, i) => ({ key: `${u.key}:${i}`, frame: f.frame, pos: shifted(p, f), owner: u.owner }));
        }),
    [shown, map, k],
  );
  const sprites = useMemo(
    () => figures.map((f) => spriteRect(colorOf(f.owner), f.frame, f.pos.faceLeft)),
    [figures], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const xforms = useMemo(() => figures.map((f) => frameXform(f.pos)), [figures]);
  return (
    <Group>
      {atlas.image ? (
        <Atlas image={atlas.image} sprites={sprites} transforms={xforms} />
      ) : atlas.failed ? (
        figures.map((f) => <UnitVector key={f.key} pos={f.pos} color={colorOf(f.owner) ?? NEUTRAL} frame={f.frame} />)
      ) : null}
      {font &&
        shown.map((u) => {
          const p = unitPos(map, u, k);
          const y = u.owner === null ? p.y - p.size * 0.45 : plateY(p, k);
          return (
            <UnitPlate
              key={u.key}
              x={p.x}
              y={y}
              label={u.recruited ? `${u.troops}+` : `${u.troops}`}
              color={colorOf(u.owner)}
              font={font}
              k={k}
            />
          );
        })}
    </Group>
  );
});

/** Запасной вариант без атласа: та же фигурка вектором. */
export function UnitVector({ pos, color, fight, frame }: { pos: UnitPos; color: string; fight?: boolean; frame?: UnitFrame }) {
  const s = pos.size / UNIT_PX;
  const transform = [
    { translateX: pos.x - (pos.faceLeft ? -pos.size / 2 : pos.size / 2) },
    { translateY: pos.y - pos.size * 0.93 },
    { scaleX: pos.faceLeft ? -s : s },
    { scaleY: s },
  ];
  return (
    <Group transform={transform}>
      <Frame frame={frame ?? (pos.ship ? 'ship' : fight ? 'fight' : 'idle')} color={color} />
    </Group>
  );
}
