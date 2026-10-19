import { Rng, seedFrom, type MapDef } from '../../engine';
import { cellAt, type MapGeometry } from './geometry';

export interface DecorItem {
  kind: number;
  x: number;
  y: number;
}

const cache = new Map<string, DecorItem[]>();

/** Широта точки карты; у старых карт без данных — условная, север сверху (55° → 35°). */
function latitudeAt(map: MapDef, y: number): number {
  const [top, bottom] = map.decor?.lat ?? [65, 35];
  return top + ((bottom - top) * y) / map.height;
}

/** Дерево по климату: ели на севере, лиственные в умеренном поясе, пальмы в тропиках. */
function treeFor(lat: number, r: number): number {
  const a = Math.abs(lat);
  if (a >= 55) return r < 0.7 ? 2 : r < 0.85 ? 0 : 5;
  if (a >= 38) return r < 0.45 ? 0 : r < 0.7 ? 1 : r < 0.85 ? 2 : 5;
  if (a >= 25) return r < 0.35 ? 3 : r < 0.6 ? 1 : 5;
  return r < 0.55 ? 3 : r < 0.85 ? 0 : 5;
}

/**
 * Декор суши, расставленный по сиду карты: горы — на хребтах из данных карты,
 * деревья — по широте (ели на севере, пальмы в тропиках), холмы между ними.
 */
export function decorFor(geo: MapGeometry): DecorItem[] {
  const map: MapDef = geo.map;
  const hit = cache.get(map.id);
  if (hit) return hit;
  const rng = new Rng(seedFrom(map.id));
  const items: DecorItem[] = [];
  const far = (x: number, y: number, d: number) => items.every((it) => Math.hypot(it.x - x, it.y - y) > d);
  const awayFromCity = (x: number, y: number) =>
    map.cells.every((c) => c.kind !== 'land' || Math.hypot(c.center[0] - x, c.center[1] - y) > 34);

  for (const [x, y] of map.decor?.mountains ?? []) {
    for (let k = 0; k < 3; k++) {
      const px = x + rng.range(-16, 16);
      const py = y + rng.range(-10, 10);
      if (far(px, py, 13) && awayFromCity(px, py) && cellAt(geo, px, py) !== null) items.push({ kind: 4, x: px, y: py });
    }
  }

  for (const c of map.cells) {
    if (c.kind !== 'land') continue;
    const [x0, y0, x1, y1] = geo.bounds[c.id];
    const want = Math.max(1, Math.min(6, Math.round(geo.areas[c.id] / 9000)));
    let placed = 0;
    for (let attempt = 0; attempt < want * 8 && placed < want; attempt++) {
      const x = rng.range(x0, x1);
      const y = rng.range(y0, y1);
      if (cellAt(geo, x, y) !== c.id || !far(x, y, 16) || !awayFromCity(x, y)) continue;
      const kind = treeFor(latitudeAt(map, y), rng.next());
      items.push({ kind, x, y });
      placed++;
    }
  }
  // Сверху вниз, чтобы ближние объекты перекрывали дальние.
  items.sort((a, b) => a.y - b.y);
  cache.set(map.id, items);
  return items;
}
