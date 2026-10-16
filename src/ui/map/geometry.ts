import { FillType, Skia, type SkPath, type SkPathBuilder } from '@shopify/react-native-skia';
import type { CellId, CellState, MapDef } from '../../engine';

// Геометрия карты в координатах карты. Строится один раз на карту и кэшируется.

const BG = -1;

export interface Edge {
  a: CellId;
  /** Клетка с другой стороны; -1 — фоновая суша, -2 — край карты. */
  b: number;
  pts: number[];
}

export interface MapGeometry {
  map: MapDef;
  cellPaths: SkPath[];
  landPath: SkPath;
  seaPath: SkPath;
  backgroundPath: SkPath;
  /** Береговая линия играбельной и фоновой суши. */
  coastPath: SkPath;
  /** Все границы между провинциями суши. */
  provinceBorders: SkPath;
  /** Границы между морскими зонами. */
  seaBorders: SkPath;
  edges: Edge[];
  /** Габариты клеток для быстрого попадания пальцем. */
  bounds: [number, number, number, number][];
  /** Площадь (для подбора размера иконок). */
  areas: number[];
  hatch: SkPath;
}

const cache = new Map<string, MapGeometry>();

function ringPath(path: SkPathBuilder, ring: number[]): void {
  if (ring.length < 6) return;
  path.moveTo(ring[0], ring[1]);
  for (let i = 2; i < ring.length; i += 2) path.lineTo(ring[i], ring[i + 1]);
  path.close();
}

function ringArea(r: number[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) s += (r[j] + r[i]) * (r[j + 1] - r[i + 1]);
  return Math.abs(s / 2);
}

export function getGeometry(map: MapDef): MapGeometry {
  const hit = cache.get(map.id);
  if (hit) return hit;

  const cellPaths = map.cells.map((c) => {
    const b = Skia.PathBuilder.Make();
    b.setFillType(FillType.EvenOdd);
    c.rings.forEach((r) => ringPath(b, r));
    return b.build();
  });
  const landB = Skia.PathBuilder.Make();
  landB.setFillType(FillType.EvenOdd);
  const seaB = Skia.PathBuilder.Make();
  map.cells.forEach((c, i) => (c.kind === 'land' ? landB : seaB).addPath(cellPaths[i]));
  const landPath = landB.build();
  const seaPath = seaB.build();
  const bgB = Skia.PathBuilder.Make();
  bgB.setFillType(FillType.EvenOdd);
  map.background?.forEach((r) => ringPath(bgB, r));
  const backgroundPath = bgB.build();

  // Рёбра: одинаковые отрезки у соседних контуров совпадают (общая топология из mapshaper).
  const owners = new Map<string, number[]>();
  const segs: { key: string; cell: number; x1: number; y1: number; x2: number; y2: number }[] = [];
  const addRing = (cell: number, r: number[]) => {
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length;
      const x1 = r[i], y1 = r[i + 1], x2 = r[j], y2 = r[j + 1];
      const key = x1 < x2 || (x1 === x2 && y1 < y2) ? `${x1},${y1},${x2},${y2}` : `${x2},${y2},${x1},${y1}`;
      let list = owners.get(key);
      if (!list) owners.set(key, (list = []));
      list.push(cell);
      segs.push({ key, cell, x1, y1, x2, y2 });
    }
  };
  map.cells.forEach((c) => c.rings.forEach((r) => addRing(c.id, r)));
  map.background?.forEach((r) => addRing(BG, r));

  const edges: Edge[] = [];
  const coastB = Skia.PathBuilder.Make();
  const provinceB = Skia.PathBuilder.Make();
  const seaBordersB = Skia.PathBuilder.Make();
  const seen = new Set<string>();
  for (const s of segs) {
    if (s.cell === BG || seen.has(`${s.key}|${s.cell}`)) continue;
    seen.add(`${s.key}|${s.cell}`);
    const list = owners.get(s.key)!;
    const other = list.find((x) => x !== s.cell) ?? -2;
    edges.push({ a: s.cell, b: other, pts: [s.x1, s.y1, s.x2, s.y2] });
    const aLand = map.cells[s.cell].kind === 'land';
    const bLand = other === BG || (other >= 0 && map.cells[other].kind === 'land');
    const bSea = other >= 0 && map.cells[other].kind === 'sea';
    // Каждый общий отрезок рисуем один раз — со стороны клетки с меньшим id.
    const first = other < 0 || s.cell < other;
    if (aLand && bSea) {
      coastB.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
    } else if (aLand && other >= 0 && bLand && first) {
      provinceB.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
    } else if (!aLand && bSea && first) {
      seaBordersB.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
    }
  }
  // Берег фоновой суши — тоже для прибоя.
  for (const s of segs) {
    if (s.cell !== BG) continue;
    const list = owners.get(s.key)!;
    if (list.some((x) => x >= 0 && map.cells[x].kind === 'sea')) coastB.moveTo(s.x1, s.y1).lineTo(s.x2, s.y2);
  }
  const coastPath = coastB.build();
  const provinceBorders = provinceB.build();
  const seaBorders = seaBordersB.build();

  const bounds = map.cells.map((c) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of c.rings) {
      for (let i = 0; i < r.length; i += 2) {
        x0 = Math.min(x0, r[i]);
        x1 = Math.max(x1, r[i]);
        y0 = Math.min(y0, r[i + 1]);
        y1 = Math.max(y1, r[i + 1]);
      }
    }
    return [x0, y0, x1, y1] as [number, number, number, number];
  });
  const areas = map.cells.map((c) => c.rings.reduce((s, r) => s + ringArea(r), 0));

  // Диагональная штриховка нейтральных провинций — одна сетка линий на всю карту.
  const hatchB = Skia.PathBuilder.Make();
  const step = 9;
  for (let k = -map.height; k < map.width; k += step) hatchB.moveTo(k, 0).lineTo(k + map.height, map.height);
  const hatch = hatchB.build();

  const geo: MapGeometry = {
    map,
    cellPaths,
    landPath,
    seaPath,
    backgroundPath,
    coastPath,
    provinceBorders,
    seaBorders,
    edges,
    bounds,
    areas,
    hatch,
  };
  cache.set(map.id, geo);
  return geo;
}

/** Клетка под точкой (координаты карты). Суша проверяется раньше моря. */
export function cellAt(geo: MapGeometry, x: number, y: number): CellId | null {
  const { map, bounds } = geo;
  let seaHit: CellId | null = null;
  for (const c of map.cells) {
    const b = bounds[c.id];
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    if (!pointInCell(c.rings, x, y)) continue;
    if (c.kind === 'land') return c.id;
    seaHit = c.id;
  }
  return seaHit;
}

function pointInCell(rings: number[][], x: number, y: number): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Границы государств: суша-суша с разными владельцами (нейтралы — не государство). */
export function stateBorders(geo: MapGeometry, cells: CellState[]): SkPath {
  const path = Skia.PathBuilder.Make();
  for (const e of geo.edges) {
    if (e.b < 0 || e.a > e.b) continue;
    if (geo.map.cells[e.a].kind !== 'land' || geo.map.cells[e.b].kind !== 'land') continue;
    const oa = cells[e.a].owner;
    const ob = cells[e.b].owner;
    if (oa === ob || (oa === null && ob === null)) continue;
    path.moveTo(e.pts[0], e.pts[1]).lineTo(e.pts[2], e.pts[3]);
  }
  return path.build();
}

/** Территория игрока и её граница — для заливки и внутреннего свечения. */
export function territory(geo: MapGeometry, cells: CellState[], owner: number): { area: SkPath; outline: SkPath } {
  const area = Skia.PathBuilder.Make();
  area.setFillType(FillType.EvenOdd);
  const outline = Skia.PathBuilder.Make();
  geo.map.cells.forEach((c, i) => {
    if (c.kind === 'land' && cells[i].owner === owner) area.addPath(geo.cellPaths[i]);
  });
  for (const e of geo.edges) {
    if (geo.map.cells[e.a].kind !== 'land' || cells[e.a].owner !== owner) continue;
    const otherOwned = e.b >= 0 && geo.map.cells[e.b].kind === 'land' && cells[e.b].owner === owner;
    if (otherOwned) continue;
    outline.moveTo(e.pts[0], e.pts[1]).lineTo(e.pts[2], e.pts[3]);
  }
  return { area: area.build(), outline: outline.build() };
}

export function neutralArea(geo: MapGeometry, cells: CellState[]): SkPath {
  const area = Skia.PathBuilder.Make();
  area.setFillType(FillType.EvenOdd);
  geo.map.cells.forEach((c, i) => {
    if (c.kind === 'land' && cells[i].owner === null) area.addPath(geo.cellPaths[i]);
  });
  return area.build();
}
