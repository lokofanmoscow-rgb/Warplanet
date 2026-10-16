import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Canvas, Group, Rect, Skia, useTypeface, type SkFont } from '@shopify/react-native-skia';
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import type { CellId, GameState, MapDef, Move, PlayerId } from '../../engine';
import { COLORS } from '../theme';
import { cellAt, getGeometry } from './geometry';
import {
  ArrowLayer,
  CityLayer,
  DecorLayer,
  DragArrow,
  fortKey,
  LabelLayer,
  LandLayer,
  ownershipKey,
  plateAnchor,
  PlateLayer,
  SeaLayer,
  SelectionLayer,
  useNoiseTile,
  StartPointsLayer,
  WaterRipple,
  type PlateInfo,
} from './layers';
import { useSpriteImages } from './sprites';

export interface MapViewProps {
  map: MapDef;
  game: GameState;
  /** Плашки армий (с учётом приказов игрока). */
  plates: PlateInfo[];
  /** Приказы на движение и цвет стрелок. */
  moves?: Move[];
  moveColor?: string;
  selected?: CellId | null;
  /** Клетки, куда можно пойти из выделенной. */
  targets?: CellId[];
  /** Свои армии, которые можно тянуть пальцем. */
  draggable?: CellId[];
  startPoints?: { cell: CellId; color: string | null; label?: string }[];
  interactive?: boolean;
  /** Медленный дрейф карты (фон главного меню). */
  drift?: boolean;
  onTapCell?: (cell: CellId | null) => void;
  onDragMove?: (from: CellId, to: CellId) => void;
  /** Сдвиг области карты от краёв экрана (панели интерфейса). */
  insets?: { top: number; bottom: number; left: number; right: number };
  focusCell?: CellId | null;
}

const FONT_SRC = require('../../../assets/fonts/PTSans-Bold.ttf');

export function MapView(props: MapViewProps) {
  const { map, game, interactive = true } = props;
  const geo = useMemo(() => getGeometry(map), [map]);
  const images = useSpriteImages();
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

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width: w, height: h } = e.nativeEvent.layout;
      setLayout({ w, h });
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
    },
    [map, insets.left, insets.right, insets.top, insets.bottom, sc, size, tx, ty],
  );

  // Фокус на клетке (например, на столице в начале партии).
  useEffect(() => {
    if (props.focusCell == null || !layout) return;
    const [x, y] = map.cells[props.focusCell].center;
    const z = Math.max(sc.value, Math.min(size.value.maxSc, (size.value.minSc / 0.9) * 2.2));
    const cx = insets.left + (layout.w - insets.left - insets.right) / 2;
    const cy = insets.top + (layout.h - insets.top - insets.bottom) / 2;
    sc.value = withTiming(z, { duration: 450 });
    tx.value = withTiming(cx - x * z, { duration: 450 });
    ty.value = withTiming(cy - y * z, { duration: 450 });
    setZoom(z);
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

  // ---------- Перетаскивание армии ----------
  const anchors = useSharedValue<number[]>([]);
  useEffect(() => {
    const flat: number[] = [];
    for (const id of props.draggable ?? []) {
      const [x, y] = plateAnchor(map, id);
      flat.push(id, x, y);
    }
    anchors.value = flat;
  }, [props.draggable, map, anchors]);
  const dragging = useSharedValue(false);
  const dragFrom = useSharedValue<[number, number]>([0, 0]);
  const dragPoint = useSharedValue<[number, number]>([0, 0]);
  const dragCell = useSharedValue(-1);
  const panStart = useSharedValue({ x: 0, y: 0 });
  const pinchStart = useSharedValue({ sc: 1, tx: 0, ty: 0, fx: 0, fy: 0 });

  const handleTap = useCallback(
    (sx: number, sy: number) => {
      const x = (sx - tx.value) / sc.value;
      const y = (sy - ty.value) / sc.value;
      props.onTapCell?.(cellAt(geo, x, y));
    },
    [geo, props, sc, tx, ty],
  );
  const handleDrop = useCallback(
    (from: number, x: number, y: number) => {
      const to = cellAt(geo, x, y);
      if (to !== null && to !== from) props.onDragMove?.(from, to);
    },
    [geo, props],
  );
  const zoomChanged = useCallback((z: number) => setZoom(z), []);

  // В функции жестов (UI-поток) передаём только числа, а не весь объект карты с контурами.
  const mapW = map.width;
  const mapH = map.height;
  const clampView = () => {
    'worklet';
    const s = size.value;
    const mw = mapW * sc.value;
    const mh = mapH * sc.value;
    // Карта не уезжает за край дальше поля; меньшая экрана — по центру.
    const margin = 60;
    const loX = Math.min(s.w - mw - margin, (s.w - mw) / 2);
    const hiX = Math.max(margin, (s.w - mw) / 2);
    const loY = Math.min(s.h - mh - margin, (s.h - mh) / 2);
    const hiY = Math.max(margin, (s.h - mh) / 2);
    tx.value = Math.min(hiX, Math.max(loX, tx.value));
    ty.value = Math.min(hiY, Math.max(loY, ty.value));
  };

  const pan = usePanGesture({
    enabled: interactive,
    maxPointers: 1,
    minDistance: 6,
    onBegin: (e) => {
      'worklet';
      panStart.value = { x: tx.value, y: ty.value };
      dragCell.value = -1;
      // Палец на своей армии — тянем стрелку приказа, иначе двигаем карту.
      const mx = (e.x - tx.value) / sc.value;
      const my = (e.y - ty.value) / sc.value;
      const r = Math.max(22, 30 / sc.value);
      const a = anchors.value;
      let best = -1;
      let bestD = r;
      for (let i = 0; i < a.length; i += 3) {
        const d = Math.hypot(a[i + 1] - mx, a[i + 2] - my);
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
    },
    onUpdate: (e) => {
      'worklet';
      if (dragCell.value >= 0) {
        dragPoint.value = [(e.x - tx.value) / sc.value, (e.y - ty.value) / sc.value];
        return;
      }
      tx.value = panStart.value.x + e.translationX;
      ty.value = panStart.value.y + e.translationY;
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
      dragging.value = false;
      dragCell.value = -1;
    },
  });

  const pinch = usePinchGesture({
    enabled: interactive,
    onActivate: (e) => {
      'worklet';
      pinchStart.value = { sc: sc.value, tx: tx.value, ty: ty.value, fx: e.focalX, fy: e.focalY };
    },
    onUpdate: (e) => {
      'worklet';
      const st = pinchStart.value;
      const s = size.value;
      const next = Math.min(s.maxSc, Math.max(s.minSc, st.sc * e.scale));
      // Точка под пальцами остаётся на месте.
      const mx = (st.fx - st.tx) / st.sc;
      const my = (st.fy - st.ty) / st.sc;
      sc.value = next;
      tx.value = e.focalX - mx * next;
      ty.value = e.focalY - my * next;
      clampView();
    },
    onDeactivate: () => {
      'worklet';
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

  // Размер иконок в единицах карты: на экране плашка примерно одного размера при любом зуме.
  const k = Math.max(0.6, Math.min(3, 1.05 / zoom));
  const labelK = Math.max(0.6, Math.min(2.2, 1.0 / zoom));
  const showLabels = zoom >= 0.55;
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
              <LandLayer geo={geo} game={game} ownershipKey={own} noise={noise} />
              <DecorLayer geo={geo} images={images} />
              <SelectionLayer geo={geo} cell={props.selected ?? null} targets={props.targets ?? []} />
              <CityLayer geo={geo} game={game} fortKey={forts} images={images} />
              {showLabels && <LabelLayer geo={geo} font={labelFont} k={labelK} />}
              {props.startPoints && <StartPointsLayer geo={geo} points={props.startPoints} font={plateFont} k={k} />}
              <ArrowLayer geo={geo} moves={props.moves ?? []} color={moveColor} font={plateFont} k={k} />
              <PlateLayer geo={geo} game={game} plates={props.plates} font={plateFont} k={k} images={images} />
              <DragArrow from={dragFrom} point={dragPoint} active={dragging} color={moveColor} k={k} />
            </Group>
          </Canvas>
        </View>
      </GestureDetector>
    </View>
  );
}

/** Плашки по состоянию партии и плану игрока. */
export function buildPlates(
  game: GameState,
  viewer: PlayerId | null,
  projected: GameState | null,
  moves: Move[],
): PlateInfo[] {
  const out: PlateInfo[] = [];
  const outgoing = new Map<CellId, number>();
  for (const m of moves) outgoing.set(m.from, (outgoing.get(m.from) ?? 0) + m.count);
  game.cells.forEach((c, id) => {
    const mine = viewer !== null && c.owner === viewer;
    const p = mine && projected ? projected.cells[id] : c;
    if (p.troops <= 0 && !(mine && outgoing.has(id))) return;
    out.push({
      cell: id,
      owner: c.owner,
      troops: p.troops,
      outgoing: mine ? outgoing.get(id) ?? 0 : 0,
      recruited: mine && projected ? Math.max(0, projected.cells[id].troops - c.troops) : 0,
    });
  });
  return out;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
