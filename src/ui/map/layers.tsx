import React, { useEffect, useMemo, useState } from 'react';
import {
  BlurMask,
  DashPathEffect,
  drawAsImage,
  FractalNoise,
  Group,
  Image,
  Path,
  Rect,
  Shader,
  Skia,
  Text,
  useClock,
  type SkFont,
  type SkImage,
} from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { CellId, CellState, GameState, MapDef, Move, PlayerId } from '../../engine';
import { COLORS, shade, withAlpha } from '../theme';
import { decorFor } from './decor';
import { neutralArea, stateBorders, territory, type MapGeometry } from './geometry';
import { ArmyIcon, Capital, City, citySizeFor, Decor, FlagMarker, Fort, Plate, type SpriteImages } from './sprites';

// ---------- Море: статичный слой, рендерится один раз в картинку ----------

function SeaElements({ geo }: { geo: MapGeometry }) {
  const { map } = geo;
  const landAll = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    b.addPath(geo.landPath);
    b.addPath(geo.backgroundPath);
    return b.build();
  }, [geo]);
  return (
    <Group>
      <Rect x={0} y={0} width={map.width} height={map.height} color={COLORS.seaDeep} />
      {/* Градиент от берега вглубь: размытый силуэт суши цветом прибрежной воды. */}
      <Path path={landAll} color={withAlpha(COLORS.seaCoast, 0.85)}>
        <BlurMask blur={38} style="normal" />
      </Path>
      <Path path={landAll} color={withAlpha(COLORS.seaCoast, 0.9)}>
        <BlurMask blur={12} style="normal" />
      </Path>
      {/* Границы морских зон. */}
      <Path path={geo.seaBorders} color="rgba(220,240,255,0.22)" style="stroke" strokeWidth={1.4}>
        <DashPathEffect intervals={[7, 6]} />
      </Path>
      {/* Полоса прибоя 4–6 px с мягким размытием. */}
      <Path path={geo.coastPath} color="rgba(255,255,255,0.55)" style="stroke" strokeWidth={6}>
        <BlurMask blur={2.5} style="normal" />
      </Path>
      {/* Суша вне игры: приглушённая. */}
      <Path path={geo.backgroundPath} color={COLORS.background} />
      <Path path={geo.backgroundPath} opacity={0.12}>
        <FractalNoise freqX={0.08} freqY={0.08} octaves={3} />
      </Path>
      <Path path={geo.backgroundPath} color="rgba(43,33,24,0.25)" />
      <Path path={geo.backgroundPath} color={withAlpha(COLORS.border, 0.5)} style="stroke" strokeWidth={1} />
    </Group>
  );
}

const seaCache = new Map<string, SkImage>();

/** Слой моря. Пока картинка готовится (или если офскрин недоступен) — рисуется вживую. */
export function SeaLayer({ geo }: { geo: MapGeometry }) {
  const [image, setImage] = useState<SkImage | null>(() => seaCache.get(geo.map.id) ?? null);
  useEffect(() => {
    if (image) return;
    let alive = true;
    drawAsImage(<SeaElements geo={geo} />, { width: geo.map.width, height: geo.map.height })
      .then((img) => {
        if (!img || !alive) return;
        seaCache.set(geo.map.id, img);
        setImage(img);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [geo, image]);
  if (image) return <Image image={image} x={0} y={0} width={geo.map.width} height={geo.map.height} />;
  return <SeaElements geo={geo} />;
}

// ---------- Рябь воды: шейдер, анимируется ----------

const RIPPLE = Skia.RuntimeEffect.Make(`
uniform float t;
half4 main(float2 p) {
  float2 q = p / 34.0;
  float w = sin(q.x * 1.3 + t * 0.7 + sin(q.y * 0.8 + t * 0.4) * 1.6)
          * sin(q.y * 1.7 - t * 0.5 + sin(q.x * 0.6 - t * 0.3) * 1.3);
  float a = smoothstep(0.55, 1.0, w) * 0.09;
  return half4(a, a, a, a);
}`);

export function WaterRipple({ geo, animate }: { geo: MapGeometry; animate: boolean }) {
  const clock = useClock();
  const uniforms = useDerivedValue(() => ({ t: animate ? clock.value / 1000 : 0 }));
  if (!RIPPLE) return null;
  return (
    <Path path={geo.seaPath}>
      <Shader source={RIPPLE} uniforms={uniforms} />
    </Path>
  );
}

// ---------- Суша: цвет владельца, текстура, штриховка, свечение границ ----------

export function fillColor(owner: PlayerId | null, game: GameState): string {
  if (owner === null) return COLORS.neutral;
  // Чуть светлее и теплее цвета игрока — суша, а не пластик.
  return shade(game.players[owner]?.color ?? COLORS.neutral, 0.12);
}

export const LandLayer = React.memo(function LandLayer({
  geo,
  game,
  ownershipKey,
}: {
  geo: MapGeometry;
  game: GameState;
  ownershipKey: string;
}) {
  const { map } = geo;
  const cells = game.cells;
  const owners = useMemo(() => [...new Set(cells.filter((c, i) => map.cells[i].kind === 'land' && c.owner !== null).map((c) => c.owner as number))], [ownershipKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const terr = useMemo(() => owners.map((o) => ({ owner: o, ...territory(geo, cells, o) })), [ownershipKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const neutral = useMemo(() => neutralArea(geo, cells), [ownershipKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const borders = useMemo(() => stateBorders(geo, cells), [ownershipKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Group>
      {map.cells.map((c, i) =>
        c.kind === 'land' ? <Path key={c.id} path={geo.cellPaths[i]} color={fillColor(cells[i].owner, game)} /> : null,
      )}
      {/* Текстура бумаги поверх суши, 10–15%. */}
      <Path path={geo.landPath} opacity={0.13} blendMode="multiply">
        <FractalNoise freqX={0.09} freqY={0.09} octaves={3} />
      </Path>
      {/* Нейтральные провинции: лёгкая диагональная штриховка. */}
      <Group clip={neutral}>
        <Path path={geo.hatch} color="rgba(59,47,47,0.16)" style="stroke" strokeWidth={1.2} />
      </Group>
      {/* Внутреннее свечение цвета владельца у границ государства, 6–8 px. */}
      {terr.map((t) => {
        const color = game.players[t.owner].color;
        return (
          <Group key={t.owner} clip={t.area}>
            <Path path={t.outline} color={withAlpha(color, 0.22)} style="stroke" strokeWidth={16} strokeJoin="round" />
            <Path path={t.outline} color={withAlpha(color, 0.3)} style="stroke" strokeWidth={9} strokeJoin="round" />
            <Path path={t.outline} color={withAlpha(shade(color, -0.15), 0.45)} style="stroke" strokeWidth={4} strokeJoin="round" />
          </Group>
        );
      })}
      {/* Границы провинций: 1,5 px, цвет границ 40%. */}
      <Path path={geo.provinceBorders} color={withAlpha(COLORS.border, 0.4)} style="stroke" strokeWidth={1.5} strokeJoin="round" />
      {/* Берег. */}
      <Path path={geo.coastPath} color={withAlpha(COLORS.border, 0.55)} style="stroke" strokeWidth={1.2} strokeJoin="round" />
      {/* Границы государств: 3 px. */}
      <Path path={borders} color={withAlpha(COLORS.border, 0.9)} style="stroke" strokeWidth={3} strokeJoin="round" strokeCap="round" />
    </Group>
  );
});

// ---------- Декор, города, столицы, укрепления ----------

export const DecorLayer = React.memo(function DecorLayer({ geo, images }: { geo: MapGeometry; images: SpriteImages }) {
  const items = useMemo(() => decorFor(geo), [geo]);
  return (
    <Group>
      {items.map((it, i) => (
        <Decor key={i} kind={it.kind} x={it.x} y={it.y} s={1.25} images={images} />
      ))}
    </Group>
  );
});

export const CityLayer = React.memo(function CityLayer({
  geo,
  game,
  fortKey,
  images,
}: {
  geo: MapGeometry;
  game: GameState;
  fortKey: string;
  images: SpriteImages;
}) {
  void fortKey;
  const { map } = geo;
  const capitals = new Map<CellId, PlayerId>();
  for (const p of game.players) if (p.capital !== null && p.alive) capitals.set(p.capital, p.id);
  const flag = game.settings.victory === 'flag' ? game.settings.flagCell : null;
  const cells = [...map.cells].filter((c) => c.kind === 'land').sort((a, b) => a.center[1] - b.center[1]);
  return (
    <Group>
      {cells.map((c) => {
        const [x, y] = c.center;
        const st = game.cells[c.id];
        const cap = capitals.get(c.id);
        return (
          <Group key={c.id}>
            {cap !== undefined ? (
              <Capital x={x} y={y + 6} s={1.15} color={game.players[cap].color} images={images} />
            ) : (
              <City x={x} y={y + 6} s={1.15} size={citySizeFor(st.pop)} images={images} />
            )}
            {st.fortified && <Fort x={x} y={y + 6} s={1.15} images={images} />}
            {flag === c.id && (
              <FlagMarker x={x + 16} y={y + 4} s={1.1} color={game.flag.holder !== null ? game.players[game.flag.holder].color : COLORS.gold} />
            )}
          </Group>
        );
      })}
    </Group>
  );
});

// ---------- Подписи ----------

export function LabelLayer({ geo, font, k }: { geo: MapGeometry; font: SkFont | null; k: number }) {
  if (!font) return null;
  const size = font.getSize();
  return (
    <Group transform={[]}>
      {geo.map.cells.map((c) => {
        if (c.kind !== 'land') return null;
        const w = font.measureText(c.name).width * k;
        const x = c.center[0] - w / 2;
        const y = c.center[1] + 18 + size * k;
        return (
          <Group key={c.id} transform={[{ translateX: x }, { translateY: y }, { scale: k }]}>
            <Text x={0.8} y={0.8} text={c.name} font={font} color="rgba(0,0,0,0.45)" />
            <Text x={0} y={0} text={c.name} font={font} color="#2B2118" />
          </Group>
        );
      })}
    </Group>
  );
}

// ---------- Плашки численности ----------

export interface PlateInfo {
  cell: CellId;
  owner: PlayerId | null;
  troops: number;
  /** Сколько уходит по приказам (для своих армий). */
  outgoing: number;
  /** Нанято в этом ходу. */
  recruited: number;
}

export function plateAnchor(map: MapDef, cell: CellId): [number, number] {
  const c = map.cells[cell];
  return c.kind === 'sea' ? c.center : [c.center[0], c.center[1] - 26];
}

export function PlateLayer({
  geo,
  game,
  plates,
  font,
  k,
  images,
}: {
  geo: MapGeometry;
  game: GameState;
  plates: PlateInfo[];
  font: SkFont | null;
  k: number;
  images: SpriteImages;
}) {
  if (!font) return null;
  const size = font.getSize();
  return (
    <Group>
      {plates.map((p) => {
        const [x, y] = plateAnchor(geo.map, p.cell);
        const left = p.troops - p.outgoing;
        if (left <= 0) return null;
        const label = p.recruited > 0 ? `${left}+` : `${left}`;
        const tw = font.measureText(label).width;
        const neutral = p.owner === null;
        const iconW = neutral ? 0 : 12;
        const width = (tw + iconW + 10) * k;
        const color = p.owner !== null ? game.players[p.owner].color : null;
        const sea = geo.map.cells[p.cell].kind === 'sea';
        const textX = x - width / 2 + (iconW + 5) * k;
        return (
          <Group key={p.cell}>
            <Plate x={x} y={y} s={k} width={width} color={color} dim={neutral} />
            {!neutral && <ArmyIcon x={x - width / 2 + 8 * k} y={y + 2 * k} s={k * 0.85} color={color!} sea={sea} images={images} />}
            <Group transform={[{ translateX: textX }, { translateY: y + (size * 0.36) * k }, { scale: k }]}>
              <Text x={0} y={0} text={label} font={font} color={neutral ? '#EDE3CF' : COLORS.text} />
            </Group>
          </Group>
        );
      })}
    </Group>
  );
}

// ---------- Стрелки приказов ----------

function arrowPath(x1: number, y1: number, x2: number, y2: number, bend: number, head: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const cx = (x1 + x2) / 2 + nx * len * bend;
  const cy = (y1 + y2) / 2 + ny * len * bend;
  // Укорачиваем к концу, чтобы наконечник не залезал на плашку.
  const ex = x2 - (dx / len) * head * 0.6;
  const ey = y2 - (dy / len) * head * 0.6;
  const body = Skia.PathBuilder.Make().moveTo(x1, y1).quadTo(cx, cy, ex, ey).build();
  // Наконечник по касательной в конце кривой.
  const tx = ex - cx;
  const ty = ey - cy;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const tip = [ex + ux * head, ey + uy * head];
  const headPath = Skia.PathBuilder.Make()
    .moveTo(tip[0], tip[1])
    .lineTo(ex - uy * head * 0.7, ey + ux * head * 0.7)
    .lineTo(ex + uy * head * 0.7, ey - ux * head * 0.7)
    .close()
    .build();
  return { body, headPath, mid: [(x1 + 2 * cx + ex) / 4, (y1 + 2 * cy + ey) / 4] as [number, number] };
}

export function ArrowLayer({
  geo,
  moves,
  color,
  font,
  k,
}: {
  geo: MapGeometry;
  moves: Move[];
  color: string;
  font: SkFont | null;
  k: number;
}) {
  return (
    <Group>
      {moves.map((m, i) => {
        const [x1, y1] = plateAnchor(geo.map, m.from);
        const [x2, y2] = geo.map.cells[m.to].center;
        const a = arrowPath(x1, y1, x2, y2, 0.18, 11 * k);
        const label = `${m.count}`;
        const tw = font ? font.measureText(label).width * k * 0.85 : 0;
        return (
          <Group key={i}>
            <Path path={a.body} color="rgba(30,20,12,0.55)" style="stroke" strokeWidth={7 * k} strokeCap="round" />
            <Path path={a.headPath} color="rgba(30,20,12,0.55)" style="stroke" strokeWidth={3 * k} strokeJoin="round" />
            <Path path={a.body} color={color} style="stroke" strokeWidth={4.2 * k} strokeCap="round" />
            <Path path={a.headPath} color={color} />
            {font && (
              <Group>
                <Rect x={a.mid[0] - tw / 2 - 3 * k} y={a.mid[1] - 7 * k} width={tw + 6 * k} height={12 * k} color="rgba(43,33,24,0.85)" />
                <Group transform={[{ translateX: a.mid[0] - tw / 2 }, { translateY: a.mid[1] + 3.2 * k }, { scale: k * 0.85 }]}>
                  <Text x={0} y={0} text={label} font={font} color={COLORS.text} />
                </Group>
              </Group>
            )}
          </Group>
        );
      })}
    </Group>
  );
}

/** Стрелка, которую тянет палец. */
export function DragArrow({
  from,
  point,
  active,
  color,
  k,
}: {
  from: SharedValue<[number, number]>;
  point: SharedValue<[number, number]>;
  active: SharedValue<boolean>;
  color: string;
  k: number;
}) {
  const path = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    if (active.value) {
      b.moveTo(from.value[0], from.value[1]);
      b.lineTo(point.value[0], point.value[1]);
    }
    return b.build();
  });
  return (
    <Group>
      <Path path={path} color="rgba(30,20,12,0.5)" style="stroke" strokeWidth={8 * k} strokeCap="round" />
      <Path path={path} color={color} style="stroke" strokeWidth={5 * k} strokeCap="round">
        <DashPathEffect intervals={[10 * k, 6 * k]} />
      </Path>
    </Group>
  );
}

// ---------- Выделение: яркость +15% и пульсирующий контур ----------

export function SelectionLayer({
  geo,
  cell,
  targets,
}: {
  geo: MapGeometry;
  cell: CellId | null;
  targets: CellId[];
}) {
  const clock = useClock();
  const pulse = useDerivedValue(() => 0.55 + 0.45 * Math.sin(clock.value / 260));
  const width = useDerivedValue(() => 2.5 + 2 * pulse.value);
  if (cell === null) return null;
  const path = geo.cellPaths[cell];
  return (
    <Group>
      <Path path={path} color="rgba(255,255,255,0.15)" />
      {targets.map((t) => (
        <Path key={t} path={geo.cellPaths[t]} color="rgba(255,248,220,0.55)" style="stroke" strokeWidth={2}>
          <DashPathEffect intervals={[6, 5]} />
        </Path>
      ))}
      <Path path={path} color={COLORS.goldLight} style="stroke" strokeWidth={width} opacity={pulse} strokeJoin="round" />
    </Group>
  );
}

/** Подсветка стартовых точек в лобби. */
export function StartPointsLayer({
  geo,
  points,
  font,
  k,
}: {
  geo: MapGeometry;
  points: { cell: CellId; color: string | null; label?: string }[];
  font: SkFont | null;
  k: number;
}) {
  const clock = useClock();
  const r = useDerivedValue(() => (22 + 4 * Math.sin(clock.value / 300)) * k);
  return (
    <Group>
      {points.map((p) => {
        const [x, y] = geo.map.cells[p.cell].center;
        return (
          <Group key={p.cell}>
            {p.color && <Path path={geo.cellPaths[p.cell]} color={withAlpha(p.color, 0.55)} />}
            <CircleRing x={x} y={y} r={r} color={p.color ?? COLORS.goldLight} k={k} />
            {font && p.label && (
              <Group transform={[{ translateX: x - (font.measureText(p.label).width * k) / 2 }, { translateY: y - 30 * k }, { scale: k }]}>
                <Text x={1} y={1} text={p.label} font={font} color="rgba(0,0,0,0.6)" />
                <Text x={0} y={0} text={p.label} font={font} color={COLORS.text} />
              </Group>
            )}
          </Group>
        );
      })}
    </Group>
  );
}

function CircleRing({ x, y, r, color, k }: { x: number; y: number; r: SharedValue<number>; color: string; k: number }) {
  const path = useDerivedValue(() => Skia.PathBuilder.Make().addCircle(x, y, r.value).build());
  return (
    <Group>
      <Path path={path} color="rgba(0,0,0,0.4)" style="stroke" strokeWidth={6 * k} />
      <Path path={path} color={color} style="stroke" strokeWidth={3.5 * k} />
    </Group>
  );
}

export function ownershipKey(cells: CellState[]): string {
  let s = '';
  for (const c of cells) s += c.owner === null ? '.' : String.fromCharCode(65 + c.owner);
  return s;
}

export function fortKey(game: GameState): string {
  let s = '';
  for (const c of game.cells) s += c.fortified ? '1' : '0';
  for (const p of game.players) s += `|${p.capital}`;
  return s + `|${game.flag.holder}`;
}
