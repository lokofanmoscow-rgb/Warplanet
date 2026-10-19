import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Canvas, Group, Line, Path, Skia, vec, type SkPath } from '@shopify/react-native-skia';
import type { GameState, PlayerId } from '../../engine';
import { Segmented, T } from '../components';
import { fmt } from '../describe';
import { COLORS, useLayout } from '../theme';

// График итогов партии: одна ось, по линии на игрока. Цвет игрока на графике тот же, что на карте;
// чтобы игроков различали и при нарушениях цветового зрения, у каждого ещё и своя форма маркера,
// легенда с именами и подсказка со значениями по касанию.

export type Metric = 'provinces' | 'army' | 'gold' | 'income';

const METRIC_LABEL: Record<Metric, string> = {
  provinces: 'Провинции',
  army: 'Армия',
  gold: 'Золото',
  income: 'Доход',
};

/** Ряды «ход → значения игроков». Провинции есть всегда, остальное — в партиях с версии 0.6. */
export function seriesOf(game: GameState, metric: Metric): number[][] {
  if (metric === 'provinces') return game.history;
  return game.stats?.[metric] ?? [];
}

export function availableMetrics(game: GameState): Metric[] {
  return (['provinces', 'army', 'gold', 'income'] as Metric[]).filter((m) => seriesOf(game, m).length > 1);
}

/** Ровные деления оси: 1, 2 или 5 × 10ⁿ, четыре-пять штук. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((v) => v >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v));
  return out;
}

function compact(v: number): string {
  return v >= 10000 ? `${Math.round(v / 1000)} тыс` : fmt(v);
}

/** Форма маркера игрока (вторая подсказка после цвета). */
function markerPath(i: number, x: number, y: number, r: number): SkPath {
  const b = Skia.PathBuilder.Make();
  const poly = (n: number, rot: number, rr = r) => {
    for (let k = 0; k < n; k++) {
      const a = rot + (Math.PI * 2 * k) / n;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (k === 0) b.moveTo(px, py);
      else b.lineTo(px, py);
    }
    b.close();
  };
  switch (i % 8) {
    case 0:
      b.addCircle(x, y, r);
      break;
    case 1:
      b.addRect(Skia.XYWHRect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7));
      break;
    case 2:
      poly(3, -Math.PI / 2, r * 1.15);
      break;
    case 3:
      poly(4, 0, r * 1.1);
      break;
    case 4:
      poly(3, Math.PI / 2, r * 1.15);
      break;
    case 5:
      poly(5, -Math.PI / 2, r * 1.05);
      break;
    case 6:
      poly(6, 0, r * 1.05);
      break;
    default: {
      // Крест.
      const t = r * 0.42;
      b.addRect(Skia.XYWHRect(x - r, y - t, r * 2, t * 2));
      b.addRect(Skia.XYWHRect(x - t, y - r, t * 2, r * 2));
    }
  }
  return b.build();
}

function Marker({ index, color, x, y, r, ring }: { index: number; color: string; x: number; y: number; r: number; ring: string }) {
  return (
    <Group>
      {/* Кольцо цвета подложки — маркер читается и поверх линий. */}
      <Path path={markerPath(index, x, y, r + 2)} color={ring} />
      <Path path={markerPath(index, x, y, r)} color={color} />
    </Group>
  );
}

const PAD = { left: 44, right: 12, top: 10, bottom: 22 };

/** Линейный график показателя по ходам с легендой и подсказкой по касанию. */
export function StatsChart({ game, width, height }: { game: GameState; width: number; height: number }) {
  const { s } = useLayout();
  const metrics = availableMetrics(game);
  const [metric, setMetric] = useState<Metric>('provinces');
  const [hover, setHover] = useState<number | null>(null);
  const rows = seriesOf(game, metric);
  const n = Math.max(1, rows.length - 1);
  const pad = { left: PAD.left * s, right: PAD.right * s, top: PAD.top * s, bottom: PAD.bottom * s };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const ticks = niceTicks(Math.max(1, ...rows.flat()));
  const top = ticks[ticks.length - 1];
  const xOf = (i: number) => pad.left + (i / n) * w;
  const yOf = (v: number) => pad.top + h - (v / top) * h;
  // Выбывший игрок — линия до хода выбывания.
  const lastIndex = (id: PlayerId) => {
    const p = game.players[id];
    return p.alive || p.eliminatedTurn === undefined ? rows.length - 1 : Math.min(rows.length - 1, p.eliminatedTurn);
  };
  const xTicks = niceTicks(n).filter((t) => t <= n);

  const lines = useMemo(
    () =>
      game.players.map((p) => {
        const b = Skia.PathBuilder.Make();
        const last = lastIndex(p.id);
        for (let i = 0; i <= last; i++) {
          const v = rows[i]?.[p.id] ?? 0;
          if (i === 0) b.moveTo(xOf(i), yOf(v));
          else b.lineTo(xOf(i), yOf(v));
        }
        return b.build();
      }),
    [game, metric, width, height], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const pick = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.locationX;
    setHover(Math.max(0, Math.min(n, Math.round(((x - pad.left) / w) * n))));
  };
  const hoverRows =
    hover === null
      ? []
      : game.players
          .filter((p) => hover <= lastIndex(p.id))
          .map((p) => ({ p, v: rows[hover]?.[p.id] ?? 0 }))
          .sort((a, b) => b.v - a.v);
  const tipLeft = hover !== null && xOf(hover) > width / 2;

  return (
    <View style={{ gap: 8 * s }}>
      {metrics.length > 1 && (
        <Segmented<Metric> options={metrics.map((m) => ({ value: m, label: METRIC_LABEL[m] }))} value={metric} onChange={setMetric} />
      )}
      <View
        style={{ width, height }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={pick}
        onResponderMove={pick}
        onResponderRelease={() => setHover(null)}
        onResponderTerminate={() => setHover(null)}
      >
        <Canvas style={{ width, height }}>
          {/* Сетка — волосяные линии на шаг светлее подложки. */}
          {ticks.map((t) => (
            <Line key={t} p1={vec(pad.left, yOf(t))} p2={vec(width - pad.right, yOf(t))} color={COLORS.panelLight} strokeWidth={1} />
          ))}
          {lines.map((path, i) => (
            <Path key={i} path={path} color={game.players[i].color} style="stroke" strokeWidth={2} strokeJoin="round" strokeCap="round" />
          ))}
          {game.players.map((p, i) => {
            const last = lastIndex(p.id);
            return (
              <Marker key={p.id} index={i} color={p.color} x={xOf(last)} y={yOf(rows[last]?.[p.id] ?? 0)} r={4.5 * s} ring={COLORS.panelDeep} />
            );
          })}
          {hover !== null && (
            <Group>
              <Line p1={vec(xOf(hover), pad.top)} p2={vec(xOf(hover), pad.top + h)} color={COLORS.textDim} strokeWidth={1} />
              {hoverRows.map(({ p, v }) => (
                <Marker key={p.id} index={p.id} color={p.color} x={xOf(hover)} y={yOf(v)} r={4 * s} ring={COLORS.panelDeep} />
              ))}
            </Group>
          )}
        </Canvas>
        {/* Подписи осей — текстом приложения, не цветом данных. */}
        {ticks.map((t) => (
          <T key={t} dim size={10} style={[styles.yLabel, { top: yOf(t) - 7 * s, width: pad.left - 6 * s }]}>
            {compact(t)}
          </T>
        ))}
        {xTicks.map((t) => (
          <T key={t} dim size={10} style={[styles.xLabel, { left: xOf(t) - 20 * s, top: pad.top + h + 4 * s, width: 40 * s }]}>
            {t}
          </T>
        ))}
        {hover !== null && (
          <View
            pointerEvents="none"
            style={[
              styles.tip,
              { top: pad.top, padding: 6 * s, borderRadius: 6 * s, gap: 2 * s },
              tipLeft ? { right: width - xOf(hover) + 8 * s } : { left: xOf(hover) + 8 * s },
            ]}
          >
            <T bold size={11}>
              Ход {hover}
            </T>
            {hoverRows.map(({ p, v }) => (
              <View key={p.id} style={[styles.row, { gap: 5 * s }]}>
                <MarkerIcon index={p.id} color={p.color} size={10 * s} />
                <T size={11} numberOfLines={1} style={{ maxWidth: 110 * s }}>
                  {p.name}
                </T>
                <T bold size={11}>
                  {fmt(v)}
                </T>
              </View>
            ))}
          </View>
        )}
      </View>
      {/* Легенда: форма и цвет маркера, имя, итог. */}
      <View style={[styles.legend, { gap: 4 * s }]}>
        {game.players.map((p, i) => (
          <View key={p.id} style={[styles.row, { gap: 6 * s, minWidth: 140 * s }]}>
            <MarkerIcon index={i} color={p.color} size={12 * s} />
            <T size={12} numberOfLines={1} style={{ flexShrink: 1 }}>
              {p.name}
            </T>
            <T dim size={12}>
              {fmt(rows[lastIndex(p.id)]?.[p.id] ?? 0)}
            </T>
          </View>
        ))}
      </View>
      <T dim size={11}>
        Проведите пальцем по графику, чтобы увидеть значения за любой ход.
      </T>
    </View>
  );
}

function MarkerIcon({ index, color, size }: { index: number; color: string; size: number }) {
  return (
    <Canvas style={{ width: size, height: size }}>
      <Path path={markerPath(index, size / 2, size / 2, size * 0.38)} color={color} />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  yLabel: { position: 'absolute', left: 0, textAlign: 'right' },
  xLabel: { position: 'absolute', textAlign: 'center' },
  tip: { position: 'absolute', backgroundColor: 'rgba(30,23,17,0.94)', borderWidth: 1, borderColor: COLORS.goldDark },
  row: { flexDirection: 'row', alignItems: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap' },
});
