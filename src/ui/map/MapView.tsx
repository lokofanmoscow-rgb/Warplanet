import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Atlas, Canvas, Group, Rect, Skia, useTypeface, type SkFont, type SkImage } from '@shopify/react-native-skia';
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { Easing, runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { isPeaceful, type CellId, type GameState, type MapDef, type PlanResult, type PlayerId, type PlayerOrders } from '../../engine';
import { COLORS } from '../theme';
import { cellAt, getGeometry, type MapGeometry } from './geometry';
import {
  ArrowLayer,
  DragArrow,
  FogLayer,
  fortKey,
  ownershipKey,
  SeaLayer,
  SelectionLayer,
  useNoiseTile,
  StartPointsLayer,
  WaterRipple,
} from './layers';
import { useSpriteImages } from './sprites';
import { BASE_RES, StaticMap, type DetailRequest } from './StaticMap';
import {
  borderPos,
  frameRect,
  grabPoint,
  homePos,
  plateY,
  UnitLayer,
  UnitPlate,
  unitPos,
  UNIT_PX,
  useUnitAtlas,
  type UnitInfo,
  type UnitPos,
} from './units';

/** Армия идёт по пути сразу после приказа. */
export interface WalkInfo {
  id: number;
  owner: PlayerId;
  count: number;
  /** Клетки пути от исходной до цели включительно. */
  path: CellId[];
  /** Атака: армия останавливается на границе перед последней клеткой. */
  attack: boolean;
}

/** Время на один шаг армии по карте, мс. */
export const WALK_STEP_MS = 320;

export interface MapViewProps {
  map: MapDef;
  game: GameState;
  /** Армии (с учётом приказов игрока). */
  units: UnitInfo[];
  /** Цвет стрелки, которую тянет палец. */
  moveColor?: string;
  /** Армия, идущая по пути прямо сейчас. */
  walk?: WalkInfo | null;
  /** Клетки, где армии временно не показываются. */
  hiddenUnits?: ReadonlySet<CellId>;
  /** Туман войны: что видит игрок; остальное затемнено. */
  visible?: ReadonlySet<CellId> | null;
  /** Слой поверх армий (показ боя). */
  overlay?: (ctx: { geo: MapGeometry; k: number; font: SkFont | null; atlas: SkImage | null }) => React.ReactNode;
  selected?: CellId | null;
  /** Клетки, куда можно пойти из выделенной. */
  targets?: CellId[];
  /** Свои армии, которые можно тянуть пальцем. */
  draggable?: CellId[];
  startPoints?: { cell: CellId; color: string | null; label?: string }[];
  interactive?: boolean;
  /** Медленный дрейф карты (фон главного меню). */
  drift?: boolean;
  /** Тап по клетке; at — точка касания на экране (для меню рядом с пальцем). */
  onTapCell?: (cell: CellId | null, at: { x: number; y: number }) => void;
  /** Карту начали двигать или масштабировать. */
  onViewChange?: () => void;
  onDragMove?: (from: CellId, to: CellId) => void;
  /** Сдвиг области карты от краёв экрана (панели интерфейса). */
  insets?: { top: number; bottom: number; left: number; right: number };
  focusCell?: CellId | null;
}

const FONT_SRC = require('../../../assets/fonts/PTSans-Bold.ttf');
const EMPTY: CellId[] = [];

export function MapView(props: MapViewProps) {
  const { map, game, interactive = true } = props;
  const geo = useMemo(() => getGeometry(map), [map]);
  const images = useSpriteImages();
  const atlas = useUnitAtlas();
  const noise = useNoiseTile();
  const typeface = useTypeface(FONT_SRC);
  const plateFont = useMemo<SkFont | null>(() => (typeface ? Skia.Font(typeface, 13) : null), [typeface]);
  const labelFont = useMemo<SkFont | null>(() => (typeface ? Skia.Font(typeface, 11) : null), [typeface]);

  // Вид: сдвиг и масштаб (точек экрана на единицу карты).
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sc = useSharedValue(0.5);
  const size = useSharedValue({ w: 1, h: 1, minSc: 0.2, maxSc: 4 });
  const [layout, setLayout] = useState<{ w: number; h: number } | null>(null);
  // Размер иконок и подписей подстраивается под масштаб после жеста.
  const [zoom, setZoom] = useState(0.5);

  const insets = props.insets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const fitted = useRef(false);
  // Обработчики берутся из ref, чтобы жесты не пересоздавались на каждой перерисовке экрана.
  const propsRef = useRef(props);
  propsRef.current = props;

  // Чёткая картинка видимой области: пересчитывается после жеста, когда карта приближена.
  const [detail, setDetail] = useState<DetailRequest | null>(null);
  const layoutRef = useRef<{ w: number; h: number } | null>(null);
  const detailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestDetail = useCallback(
    (delay = 120) => {
      if (detailTimer.current) clearTimeout(detailTimer.current);
      detailTimer.current = setTimeout(() => {
        const lay = layoutRef.current;
        if (!lay || propsRef.current.drift) return setDetail(null);
        const z = sc.value;
        const ps = z * PixelRatio.get();
        const labels = z >= 0.55;
        if (ps <= BASE_RES * 1.15 && !labels) return setDetail(null);
        // Видимая область плюс поля на случай прокрутки.
        const vx = -tx.value / z;
        const vy = -ty.value / z;
        const vw = lay.w / z;
        const vh = lay.h / z;
        const x0 = Math.max(0, vx - vw * 0.2);
        const y0 = Math.max(0, vy - vh * 0.2);
        const x1 = Math.min(map.width, vx + vw * 1.2);
        const y1 = Math.min(map.height, vy + vh * 1.2);
        if (x1 <= x0 || y1 <= y0) return setDetail(null);
        const maxPx = 4096;
        const scale = Math.min(ps, maxPx / (x1 - x0), maxPx / (y1 - y0));
        setDetail({ x0, y0, w: x1 - x0, h: y1 - y0, ps: scale, labelK: labels ? Math.max(0.6, Math.min(2.2, 1.0 / z)) : null });
      }, delay);
    },
    [map, sc, tx, ty],
  );
  useEffect(() => () => {
    if (detailTimer.current) clearTimeout(detailTimer.current);
  }, []);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width: w, height: h } = e.nativeEvent.layout;
      setLayout({ w, h });
      layoutRef.current = { w, h };
      const availW = Math.max(100, w - insets.left - insets.right);
      const availH = Math.max(100, h - insets.top - insets.bottom);
      const fit = Math.min(availW / map.width, availH / map.height);
      // На узком экране карта по высоте заполняет экран, лишнее листается.
      const cover = Math.max(availW / map.width, availH / map.height);
      const start = Math.min(cover, fit * 1.6);
      size.value = { w, h, minSc: fit * 0.9, maxSc: Math.max(3, fit * 8) };
      if (!fitted.current) {
        fitted.current = true;
        sc.value = start;
        tx.value = insets.left + (availW - map.width * start) / 2;
        ty.value = insets.top + (availH - map.height * start) / 2;
        setZoom(start);
      }
      requestDetail();
    },
    [map, insets.left, insets.right, insets.top, insets.bottom, sc, size, tx, ty, requestDetail],
  );

  // Фокус на клетке (например, на столице в начале партии).
  useEffect(() => {
    if (props.focusCell == null || !layout) return;
    const [x, y] = map.cells[props.focusCell].center;
    const z = Math.max(sc.value, Math.min(size.value.maxSc, (size.value.minSc / 0.9) * 2.2));
    const cx = insets.left + (layout.w - insets.left - insets.right) / 2;
    const cy = insets.top + (layout.h - insets.top - insets.bottom) / 2;
    // Столица у края карты — не показываем пустоту за краем.
    const [fx, fy] = clampOffset(cx - x * z, cy - y * z, z, layout.w, layout.h, map.width, map.height);
    sc.value = withTiming(z, { duration: 450 });
    tx.value = withTiming(fx, { duration: 450 });
    ty.value = withTiming(fy, { duration: 450 });
    setZoom(z);
    requestDetail(520);
  }, [props.focusCell, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Медленный дрейф для фона меню.
  useEffect(() => {
    if (!props.drift || !layout) return;
    let t = 0;
    const id = setInterval(() => {
      t += 1;
      const fit = Math.max(layout.w / map.width, layout.h / map.height) * 1.25;
      sc.value = fit;
      const rx = (map.width * fit - layout.w) / 2;
      const ry = (map.height * fit - layout.h) / 2;
      tx.value = withTiming(-rx - Math.sin(t / 40) * rx * 0.8, { duration: 1000 });
      ty.value = withTiming(-ry - Math.cos(t / 55) * ry * 0.6, { duration: 1000 });
    }, 1000);
    return () => clearInterval(id);
  }, [props.drift, layout, map]); // eslint-disable-line react-hooks/exhaustive-deps

  const transform = useDerivedValue(() => [{ translateX: tx.value }, { translateY: ty.value }, { scale: sc.value }]);

  // Размер иконок в единицах карты: на экране армия примерно одного размера при любом зуме.
  const k = Math.max(0.6, Math.min(3, 1.05 / zoom));

  // ---------- Перетаскивание армии ----------
  const anchors = useSharedValue<number[]>([]);
  useEffect(() => {
    const flat: number[] = [];
    for (const id of props.draggable ?? []) {
      const [x, y] = grabPoint(map, id, k);
      flat.push(id, x, y);
    }
    anchors.value = flat;
  }, [props.draggable, map, anchors, k]);
  const dragging = useSharedValue(false);
  const dragFrom = useSharedValue<[number, number]>([0, 0]);
  const dragPoint = useSharedValue<[number, number]>([0, 0]);
  const dragCell = useSharedValue(-1);
  // Жесты меняют вид приращениями от прошлого кадра: прокрутка и зум идут одновременно
  // и не перетирают друг друга (иначе после зума карта «перескакивала»).
  const pinching = useSharedValue(false);
  const pinchLast = useSharedValue({ scale: 1, fx: 0, fy: 0, n: 0 });

  const handleTap = useCallback(
    (sx: number, sy: number) => {
      const x = (sx - tx.value) / sc.value;
      const y = (sy - ty.value) / sc.value;
      propsRef.current.onTapCell?.(cellAt(geo, x, y), { x: sx, y: sy });
    },
    [geo, sc, tx, ty],
  );
  const viewChanged = useCallback(() => propsRef.current.onViewChange?.(), []);
  const handleDrop = useCallback(
    (from: number, x: number, y: number) => {
      const to = cellAt(geo, x, y);
      if (to !== null && to !== from) propsRef.current.onDragMove?.(from, to);
    },
    [geo],
  );
  const zoomChanged = useCallback(
    (z: number) => {
      setZoom(z);
      requestDetail();
    },
    [requestDetail],
  );
  const panEnded = useCallback(() => requestDetail(), [requestDetail]);

  // В функции жестов (UI-поток) передаём только числа, а не весь объект карты с контурами.
  const mapW = map.width;
  const mapH = map.height;
  const clampView = () => {
    'worklet';
    const s = size.value;
    const [x, y] = clampOffset(tx.value, ty.value, sc.value, s.w, s.h, mapW, mapH);
    tx.value = x;
    ty.value = y;
  };

  const pan = usePanGesture({
    enabled: interactive,
    maxPointers: 1,
    minDistance: 6,
    onBegin: (e) => {
      'worklet';
      dragCell.value = -1;
      // Палец на своей армии — тянем стрелку приказа, иначе двигаем карту.
      const mx = (e.x - tx.value) / sc.value;
      const my = (e.y - ty.value) / sc.value;
      // Захват — только по самой армии с плашкой (примерно 44×48 точек экрана), иначе карта не листалась бы.
      const rx = 22 / sc.value;
      const ry = 24 / sc.value;
      const a = anchors.value;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < a.length; i += 3) {
        const dx = Math.abs(a[i + 1] - mx);
        const dy = Math.abs(a[i + 2] - my);
        if (dx > rx || dy > ry) continue;
        const d = dx / rx + dy / ry;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        dragCell.value = a[best];
        dragFrom.value = [a[best + 1], a[best + 2]];
        dragPoint.value = [mx, my];
      }
    },
    onActivate: () => {
      'worklet';
      if (dragCell.value >= 0) dragging.value = true;
      else runOnJS(viewChanged)();
    },
    onUpdate: (e) => {
      'worklet';
      if (dragCell.value >= 0) {
        dragPoint.value = [(e.x - tx.value) / sc.value, (e.y - ty.value) / sc.value];
        return;
      }
      // Пока идёт зум, им же и двигается карта.
      if (pinching.value) return;
      tx.value += e.changeX;
      ty.value += e.changeY;
      clampView();
    },
    onDeactivate: (e) => {
      'worklet';
      if (dragCell.value >= 0) {
        const from = dragCell.value;
        dragging.value = false;
        dragCell.value = -1;
        runOnJS(handleDrop)(from, (e.x - tx.value) / sc.value, (e.y - ty.value) / sc.value);
      }
    },
    onFinalize: () => {
      'worklet';
      if (dragCell.value < 0) runOnJS(panEnded)();
      dragging.value = false;
      dragCell.value = -1;
    },
  });

  const pinch = usePinchGesture({
    enabled: interactive,
    onActivate: (e) => {
      'worklet';
      pinching.value = true;
      pinchLast.value = { scale: e.scale, fx: e.focalX, fy: e.focalY, n: e.numberOfPointers };
      runOnJS(viewChanged)();
    },
    onUpdate: (e) => {
      'worklet';
      const last = pinchLast.value;
      pinchLast.value = { scale: e.scale, fx: e.focalX, fy: e.focalY, n: e.numberOfPointers };
      // Палец оторвался или добавился — центр жеста скачет, этот кадр пропускаем.
      if (e.numberOfPointers < 2 || e.numberOfPointers !== last.n || last.scale <= 0) return;
      const s = size.value;
      const prev = sc.value;
      const next = Math.min(s.maxSc, Math.max(s.minSc, prev * (e.scale / last.scale)));
      const k = next / prev;
      // Точка карты под пальцами остаётся под пальцами (с учётом их сдвига).
      tx.value = e.focalX - (last.fx - tx.value) * k;
      ty.value = e.focalY - (last.fy - ty.value) * k;
      sc.value = next;
      clampView();
    },
    onFinalize: () => {
      'worklet';
      if (!pinching.value) return;
      pinching.value = false;
      runOnJS(zoomChanged)(sc.value);
    },
  });

  const tap = useTapGesture({
    enabled: interactive,
    maxDistance: 12,
    onActivate: (e) => {
      'worklet';
      runOnJS(handleTap)(e.x, e.y);
    },
  });

  const gesture = useCompetingGestures(tap, useSimultaneousGestures(pan, pinch));

  const own = useMemo(() => ownershipKey(game.cells), [game.cells]);
  const forts = useMemo(() => fortKey(game), [game]);
  const moveColor = props.moveColor ?? COLORS.gold;

  return (
    <View style={styles.fill} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill}>
          <Canvas style={styles.fill} opaque>
            <Rect x={0} y={0} width={layout?.w ?? 0} height={layout?.h ?? 0} color={COLORS.seaDeep} />
            <Group transform={transform}>
              <SeaLayer geo={geo} />
              <WaterRipple geo={geo} animate={!props.drift} />
              <StaticMap
                geo={geo}
                game={game}
                own={own}
                forts={forts}
                images={images}
                noise={noise}
                detail={detail}
                labelFont={labelFont}
              />
              {props.visible ? <FogLayer geo={geo} visible={props.visible} /> : null}
              <SelectionLayer geo={geo} cell={props.selected ?? null} targets={props.targets ?? EMPTY} />
              {props.startPoints && <StartPointsLayer geo={geo} points={props.startPoints} font={plateFont} k={k} />}
              <AttackArrows map={map} game={game} units={props.units} k={k} hidden={props.hiddenUnits} />
              <UnitLayer map={map} game={game} units={props.units} font={plateFont} k={k} atlas={atlas} hidden={props.hiddenUnits} />
              {props.walk && atlas.image && plateFont ? (
                <Walker key={props.walk.id} map={map} game={game} walk={props.walk} atlas={atlas.image} font={plateFont} k={k} />
              ) : null}
              {props.overlay?.({ geo, k, font: plateFont, atlas: atlas.image })}
              <DragArrow from={dragFrom} point={dragPoint} active={dragging} color={moveColor} k={k} />
            </Group>
          </Canvas>
        </View>
      </GestureDetector>
    </View>
  );
}

/** Карта не уезжает за край экрана дальше поля; если она меньше экрана — по центру. */
function clampOffset(x: number, y: number, z: number, w: number, h: number, mapW: number, mapH: number): [number, number] {
  'worklet';
  const mw = mapW * z;
  const mh = mapH * z;
  const margin = 60;
  const loX = Math.min(w - mw - margin, (w - mw) / 2);
  const hiX = Math.max(margin, (w - mw) / 2);
  const loY = Math.min(h - mh - margin, (h - mh) / 2);
  const hiY = Math.max(margin, (h - mh) / 2);
  return [Math.min(hiX, Math.max(loX, x)), Math.min(hiY, Math.max(loY, y))];
}

/**
 * Армии по состоянию партии и плану игрока: свои — как в прогнозе (мирные перемещения уже на месте),
 * отряды, идущие в атаку, стоят на границе с целью.
 */
export function buildUnits(
  game: GameState,
  viewer: PlayerId | null,
  plan: PlanResult | null,
  orders: PlayerOrders | null,
  visible: ReadonlySet<CellId> | null = null,
): UnitInfo[] {
  const out: UnitInfo[] = [];
  const recruited = new Set((orders?.actions ?? []).filter((a) => a.type === 'recruit').map((a) => a.cell));
  game.cells.forEach((c, id) => {
    const proj = plan?.projected.cells[id];
    const mine = viewer !== null && !!proj && (c.owner === viewer || proj.owner === viewer);
    const p = mine ? proj! : c;
    if (p.troops <= 0) return;
    // Чужие армии в тумане войны не видны.
    if (!mine && visible && !visible.has(id)) return;
    out.push({ key: `c${id}`, cell: id, owner: p.owner, troops: p.troops, recruited: mine && recruited.has(id) });
  });
  if (plan && orders && viewer !== null) {
    const groups = new Map<string, UnitInfo>();
    orders.moves.forEach((m, i) => {
      const r = plan.moveReach[i];
      if (!r || plan.moveErrors[i] !== null || isPeaceful(r.kind)) return;
      const stage = r.path[r.path.length - 2];
      const key = `a${stage}>${m.to}`;
      const g = groups.get(key);
      if (g) g.troops += m.count;
      else groups.set(key, { key, cell: stage, owner: viewer, troops: m.count, target: m.to });
    });
    out.push(...groups.values());
  }
  return out;
}

/** Короткие стрелки от отрядов на границе к цели атаки. */
const AttackArrows = React.memo(function AttackArrows({
  map,
  game,
  units,
  k,
  hidden,
}: {
  map: MapDef;
  game: GameState;
  units: UnitInfo[];
  k: number;
  hidden?: ReadonlySet<CellId>;
}) {
  const arrows = units
    .filter((u) => u.target !== undefined && u.owner !== null && !hidden?.has(u.target))
    .map((u) => {
      const p = unitPos(map, u, k);
      const [tx, ty] = map.cells[u.target!].center;
      return { key: u.key, x1: p.x, y1: p.y - p.size * 0.25, x2: tx, y2: ty, color: game.players[u.owner!].color };
    });
  return <ArrowLayer arrows={arrows} k={k} />;
});

/** Точки пути армии на карте. */
function walkPoints(map: MapDef, walk: WalkInfo, k: number): UnitPos[] {
  const pts = walk.path.map((id) => homePos(map, id, k));
  if (walk.attack && walk.path.length >= 2) {
    // Атака: последний шаг — только до границы.
    pts[pts.length - 1] = borderPos(map, walk.path[walk.path.length - 2], walk.path[walk.path.length - 1], k);
  }
  return pts;
}

/** Армия, идущая по пути: фигурка из атласа и плашка с числом, шаг за шагом. */
function Walker({
  map,
  game,
  walk,
  atlas,
  font,
  k,
}: {
  map: MapDef;
  game: GameState;
  walk: WalkInfo;
  atlas: SkImage;
  font: SkFont;
  k: number;
}) {
  const color = game.players[walk.owner]?.color ?? null;
  const pts = useMemo(() => walkPoints(map, walk, k), [map, walk, k]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const ships = pts.map((p) => p.ship);
  const size = pts[0].size;
  // Кадры атласа: суша вправо, суша влево, корабль вправо, корабль влево.
  const rects = [
    frameRect(color, false, false, false),
    frameRect(color, false, false, true),
    frameRect(color, true, false, false),
    frameRect(color, true, false, true),
  ].map((r) => [r.x, r.y]);
  const n = pts.length;
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(n - 1, { duration: (n - 1) * WALK_STEP_MS, easing: Easing.linear });
  }, [progress, n]);
  const seg = () => {
    'worklet';
    const p = progress.value;
    const i = Math.max(0, Math.min(n - 2, Math.floor(p)));
    return { i, f: Math.min(1, p - i) };
  };
  const at = () => {
    'worklet';
    const { i, f } = seg();
    const bob = Math.abs(Math.sin(progress.value * Math.PI * 2)) * 2.5 * k;
    return [xs[i] + (xs[i + 1] - xs[i]) * f, ys[i] + (ys[i + 1] - ys[i]) * f - bob];
  };
  const transforms = useDerivedValue(() => {
    const [x, y] = at();
    const s = size / UNIT_PX;
    return [Skia.RSXform(s, 0, x - size / 2, y - size * 0.93)];
  });
  const sprites = useDerivedValue(() => {
    const { i, f } = seg();
    const ship = f < 0.5 ? ships[i] : ships[i + 1];
    const left = xs[i + 1] < xs[i];
    const r = rects[(ship ? 2 : 0) + (left ? 1 : 0)];
    return [Skia.XYWHRect(r[0], r[1], UNIT_PX, UNIT_PX)];
  });
  const plate = useDerivedValue(() => {
    const [x, y] = at();
    return [{ translateX: x }, { translateY: y }];
  });
  const py = plateY({ x: 0, y: 0, size, ship: ships[0], faceLeft: false }, k);
  return (
    <Group>
      <Atlas image={atlas} sprites={sprites} transforms={transforms} />
      <Group transform={plate}>
        <UnitPlate x={0} y={py} label={`${walk.count}`} color={color} font={font} k={k} />
      </Group>
    </Group>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
