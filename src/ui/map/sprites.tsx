import React, { useMemo } from 'react';
import {
  BlendColor,
  Circle,
  Group,
  Image,
  Oval,
  Path,
  RadialGradient,
  Rect,
  Skia,
  useImage,
  vec,
  type SkImage,
} from '@shopify/react-native-skia';
import { SPRITES } from '../assets.generated';
import { COLORS, shade } from '../theme';

// Иконки карты. Если в assets/sprites есть PNG с нужным именем — рисуется он,
// иначе простая векторная заглушка в том же стиле: изометрия, свет слева сверху.

export type SpriteName =
  | 'city_small'
  | 'city_medium'
  | 'city_large'
  | 'capital'
  | 'fort'
  | `decor_${number}`;

export type SpriteImages = Partial<Record<string, SkImage | null>>;

const SPRITE_ENTRIES = Object.entries(SPRITES);

/** Загружает все найденные PNG. Список фиксирован на сборку, поэтому хуки в цикле безопасны. */
export function useSpriteImages(): SpriteImages {
  const loaded: (SkImage | null)[] = [];
  for (const [, src] of SPRITE_ENTRIES) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    loaded.push(useImage(src));
  }
  // Один и тот же объект, пока картинки не поменялись, — чтобы слои карты не перерисовывались зря.
  return useMemo(() => {
    const out: SpriteImages = {};
    SPRITE_ENTRIES.forEach(([name], i) => (out[name] = loaded[i]));
    return out;
  }, loaded); // eslint-disable-line react-hooks/exhaustive-deps
}

const OUTLINE = COLORS.border;

function poly(points: number[]) {
  const b = Skia.PathBuilder.Make();
  b.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) b.lineTo(points[i], points[i + 1]);
  b.close();
  return b.build();
}

function build(fn: (b: ReturnType<typeof Skia.PathBuilder.Make>) => void) {
  const b = Skia.PathBuilder.Make();
  fn(b);
  return b.build();
}

/** Мягкая тень: смещение вниз-вправо, чёрный 30%, размытие градиентом (без дорогого blur). */
export function Shadow({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const cx = x + w * 0.06;
  const cy = y + h * 0.15;
  return (
    <Oval x={cx - w / 2} y={cy - h / 2} width={w} height={h}>
      <RadialGradient c={vec(cx, cy)} r={w / 2} colors={['rgba(0,0,0,0.30)', 'rgba(0,0,0,0)']} />
    </Oval>
  );
}

/** Изометрический домик: основание по центру (x, y), ширина w. */
function House({ x, y, w, wallH, roof }: { x: number; y: number; w: number; wallH: number; roof: string }) {
  const L = [x - w / 2, y - w / 4];
  const F = [x, y];
  const R = [x + w / 2, y - w / 4];
  const up = (p: number[], d: number) => [p[0], p[1] - d];
  const apex = [x, y - w / 4 - wallH - w * 0.42];
  const left = poly([...L, ...F, ...up(F, wallH), ...up(L, wallH)]);
  const right = poly([...F, ...R, ...up(R, wallH), ...up(F, wallH)]);
  const roofL = poly([...up(L, wallH), ...up(F, wallH), ...apex]);
  const roofR = poly([...up(F, wallH), ...up(R, wallH), ...apex]);
  const sw = Math.max(0.5, w * 0.05);
  return (
    <Group>
      <Path path={left} color="#F1E6CC" />
      <Path path={right} color="#C7B48E" />
      <Path path={roofL} color={roof} />
      <Path path={roofR} color={shade(roof, -0.3)} />
      <Path path={left} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={right} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={roofL} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={roofR} color={OUTLINE} style="stroke" strokeWidth={sw} />
      {/* окошко */}
      <Rect x={x - w * 0.27} y={y - w * 0.12 - wallH * 0.55} width={w * 0.1} height={wallH * 0.3} color="#5B4A3A" />
    </Group>
  );
}

/** Башня-донжон для столицы. */
function Keep({ x, y, w, h, color }: { x: number; y: number; w: number; h: number; color: string }) {
  const L = [x - w / 2, y - w / 4];
  const F = [x, y];
  const R = [x + w / 2, y - w / 4];
  const B = [x, y - w / 2];
  const up = (p: number[]) => [p[0], p[1] - h];
  const sw = Math.max(0.5, w * 0.05);
  const left = poly([...L, ...F, ...up(F), ...up(L)]);
  const right = poly([...F, ...R, ...up(R), ...up(F)]);
  const top = poly([...up(L), ...up(F), ...up(R), ...up(B)]);
  const pole = [x, y - w / 4 - h];
  const flag = poly([pole[0], pole[1] - w * 0.95, pole[0] + w * 0.6, pole[1] - w * 0.8, pole[0], pole[1] - w * 0.62]);
  return (
    <Group>
      <Path path={left} color="#E2D6BA" />
      <Path path={right} color="#B3A27F" />
      <Path path={top} color="#CFC2A3" />
      {[0.2, 0.5, 0.8].map((t) => (
        <Rect key={t} x={L[0] + (F[0] - L[0]) * t - w * 0.05} y={L[1] + (F[1] - L[1]) * t - h - w * 0.12} width={w * 0.1} height={w * 0.12} color="#E2D6BA" />
      ))}
      <Path path={left} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={right} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={top} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Rect x={pole[0] - sw / 2} y={pole[1] - w * 0.95} width={sw} height={w * 0.95} color={OUTLINE} />
      <Path path={flag} color={color} />
      <Path path={flag} color={OUTLINE} style="stroke" strokeWidth={sw * 0.8} />
    </Group>
  );
}

function Img({ image, x, y, size, tint }: { image: SkImage; x: number; y: number; size: number; tint?: string }) {
  return (
    <Image image={image} x={x - size / 2} y={y - size} width={size} height={size}>
      {tint ? <BlendColor color={tint} mode="modulate" /> : null}
    </Image>
  );
}

export type CitySize = 'small' | 'medium' | 'large';

export function citySizeFor(pop: number): CitySize {
  return pop >= 30000 ? 'large' : pop >= 15000 ? 'medium' : 'small';
}

/** Город по населению; основание — точка (x, y). */
export function City({ x, y, s, size, images }: { x: number; y: number; s: number; size: CitySize; images: SpriteImages }) {
  const img = images[`city_${size}`];
  if (img) return <Img image={img} x={x} y={y + 4 * s} size={34 * s} />;
  const w = 13 * s;
  return (
    <Group>
      <Shadow x={x} y={y} w={size === 'small' ? 20 * s : 30 * s} h={9 * s} />
      {size !== 'small' && <House x={x - 6 * s} y={y - 3 * s} w={w * 0.9} wallH={6 * s} roof="#B5523A" />}
      {size === 'large' && <House x={x + 7 * s} y={y - 3 * s} w={w * 0.85} wallH={8 * s} roof="#9C5B3C" />}
      <House x={x} y={y + 1 * s} w={w} wallH={7 * s} roof="#C2553A" />
    </Group>
  );
}

export function Capital({ x, y, s, color, images }: { x: number; y: number; s: number; color: string; images: SpriteImages }) {
  const img = images.capital;
  if (img) return <Img image={img} x={x} y={y + 4 * s} size={40 * s} />;
  return (
    <Group>
      <Shadow x={x} y={y} w={34 * s} h={11 * s} />
      <House x={x - 9 * s} y={y - 1 * s} w={11 * s} wallH={6 * s} roof="#B5523A" />
      <House x={x + 9 * s} y={y - 1 * s} w={11 * s} wallH={6 * s} roof="#9C5B3C" />
      <Keep x={x} y={y + 2 * s} w={12 * s} h={15 * s} color={color} />
    </Group>
  );
}

/** Стены укрепления поверх города. */
export function Fort({ x, y, s, images }: { x: number; y: number; s: number; images: SpriteImages }) {
  const img = images.fort;
  if (img) return <Img image={img} x={x} y={y + 6 * s} size={40 * s} />;
  const w = 34 * s;
  const h = 5 * s;
  const L = [x - w / 2, y - w / 4 + 6 * s];
  const F = [x, y + 6 * s];
  const R = [x + w / 2, y - w / 4 + 6 * s];
  const sw = Math.max(0.5, 0.7 * s);
  const left = poly([...L, ...F, F[0], F[1] - h, L[0], L[1] - h]);
  const right = poly([...F, ...R, R[0], R[1] - h, F[0], F[1] - h]);
  const merlons: React.ReactNode[] = [];
  for (let t = 0.08; t < 1; t += 0.16) {
    const a = [L[0] + (F[0] - L[0]) * t, L[1] + (F[1] - L[1]) * t - h];
    const b = [F[0] + (R[0] - F[0]) * t, F[1] + (R[1] - F[1]) * t - h];
    merlons.push(<Rect key={`l${t}`} x={a[0] - 1.4 * s} y={a[1] - 2.4 * s} width={2.8 * s} height={2.6 * s} color="#B9B09F" />);
    merlons.push(<Rect key={`r${t}`} x={b[0] - 1.4 * s} y={b[1] - 2.4 * s} width={2.8 * s} height={2.6 * s} color="#8F8676" />);
  }
  return (
    <Group>
      <Path path={left} color="#B9B09F" />
      <Path path={right} color="#8F8676" />
      {merlons}
      <Path path={left} color={OUTLINE} style="stroke" strokeWidth={sw} />
      <Path path={right} color={OUTLINE} style="stroke" strokeWidth={sw} />
    </Group>
  );
}

/** Флаг для режима «Захват флага». */
export function FlagMarker({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  const flag = poly([x, y - 26 * s, x + 14 * s, y - 22 * s, x, y - 17 * s]);
  return (
    <Group>
      <Shadow x={x} y={y} w={10 * s} h={4 * s} />
      <Rect x={x - 0.8 * s} y={y - 26 * s} width={1.6 * s} height={26 * s} color={OUTLINE} />
      <Path path={flag} color={color} />
      <Path path={flag} color={OUTLINE} style="stroke" strokeWidth={0.8 * s} />
    </Group>
  );
}

// ---------- Декор суши ----------

export function Decor({ kind, x, y, s, images }: { kind: number; x: number; y: number; s: number; images: SpriteImages }) {
  const img = images[`decor_${kind + 1}`];
  if (img) return <Img image={img} x={x} y={y} size={18 * s} />;
  const sw = Math.max(0.4, 0.5 * s);
  switch (kind % 6) {
    case 0:
    case 1: {
      // Лиственное дерево.
      const g = kind === 0 ? '#5E8F3E' : '#6E9B45';
      return (
        <Group>
          <Shadow x={x} y={y} w={8 * s} h={3 * s} />
          <Rect x={x - 0.7 * s} y={y - 4 * s} width={1.4 * s} height={4 * s} color="#6B4A2B" />
          <Circle cx={x} cy={y - 6.5 * s} r={3.6 * s} color={g} />
          <Circle cx={x - 1.1 * s} cy={y - 7.4 * s} r={1.6 * s} color={shade(g, 0.25)} />
          <Circle cx={x} cy={y - 6.5 * s} r={3.6 * s} color={OUTLINE} style="stroke" strokeWidth={sw} />
        </Group>
      );
    }
    case 2: {
      // Ель.
      const tri = poly([x, y - 11 * s, x + 4 * s, y - 2 * s, x - 4 * s, y - 2 * s]);
      return (
        <Group>
          <Shadow x={x} y={y} w={7 * s} h={2.6 * s} />
          <Rect x={x - 0.6 * s} y={y - 2.5 * s} width={1.2 * s} height={2.5 * s} color="#5A3E25" />
          <Path path={tri} color="#3F6E3A" />
          <Path path={poly([x, y - 11 * s, x - 4 * s, y - 2 * s, x - 1 * s, y - 2 * s])} color="#4F8448" />
          <Path path={tri} color={OUTLINE} style="stroke" strokeWidth={sw} />
        </Group>
      );
    }
    case 3: {
      // Пальма.
      const leaves = build((b) => {
        for (const a of [-2.6, -1.9, -1.2, -0.5, 0.2]) {
          b.moveTo(x + 1 * s, y - 9 * s);
          b.quadTo(x + Math.cos(a) * 3 * s, y - 11 * s + Math.sin(a) * 2 * s, x + Math.cos(a) * 6 * s, y - 8 * s + Math.sin(a) * 3 * s);
        }
      });
      const trunk = build((b) => {
        b.moveTo(x, y);
        b.quadTo(x - 1.5 * s, y - 5 * s, x + 1 * s, y - 9 * s);
      });
      return (
        <Group>
          <Shadow x={x} y={y} w={7 * s} h={2.6 * s} />
          <Path path={trunk} color="#7B5B3A" style="stroke" strokeWidth={1.3 * s} strokeCap="round" />
          <Path path={leaves} color="#4E8C3F" style="stroke" strokeWidth={1.6 * s} strokeCap="round" />
        </Group>
      );
    }
    case 4: {
      // Гора со снежной шапкой.
      const lit = poly([x - 9 * s, y, x, y - 12 * s, x + 1 * s, y]);
      const dark = poly([x + 1 * s, y, x, y - 12 * s, x + 9 * s, y]);
      const snow = poly([x - 2.6 * s, y - 8.5 * s, x, y - 12 * s, x + 2.4 * s, y - 8.8 * s, x + 0.5 * s, y - 8 * s]);
      return (
        <Group>
          <Shadow x={x + 2 * s} y={y} w={18 * s} h={4 * s} />
          <Path path={lit} color="#A99A80" />
          <Path path={dark} color="#7D6F5B" />
          <Path path={snow} color="#F4F1E8" />
          <Path path={poly([x - 9 * s, y, x, y - 12 * s, x + 9 * s, y])} color={OUTLINE} style="stroke" strokeWidth={sw} />
        </Group>
      );
    }
    default: {
      // Холм.
      const hill = build((b) => {
        b.moveTo(x - 8 * s, y);
        b.quadTo(x - 2 * s, y - 8 * s, x + 7 * s, y);
        b.close();
      });
      return (
        <Group>
          <Path path={hill} color="#A7B26A" />
          <Path path={hill} color={OUTLINE} style="stroke" strokeWidth={sw} />
        </Group>
      );
    }
  }
}
