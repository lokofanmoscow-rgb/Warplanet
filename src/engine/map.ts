import type { CellId, MapDef } from './types';

// Реестр карт: движок знает карту по state.mapId и не зависит от конкретной карты.

const maps = new Map<string, MapDef>();

export function registerMap(map: MapDef): void {
  maps.set(map.id, map);
}

export function getMap(id: string): MapDef {
  const map = maps.get(id);
  if (!map) throw new Error(`Карта не найдена: ${id}`);
  return map;
}

export function hasMap(id: string): boolean {
  return maps.has(id);
}

export function listMaps(): MapDef[] {
  return [...maps.values()];
}

export function isNeighbor(map: MapDef, a: CellId, b: CellId): boolean {
  return map.cells[a]?.neighbors.includes(b) ?? false;
}

export function landCellIds(map: MapDef): CellId[] {
  return map.cells.filter((c) => c.kind === 'land').map((c) => c.id);
}

/** Расстояния в ходах от набора клеток (BFS по соседству). */
export function distancesFrom(
  map: MapDef,
  sources: CellId[],
  passable: (id: CellId) => boolean = () => true,
): number[] {
  const dist = new Array<number>(map.cells.length).fill(Infinity);
  const queue: CellId[] = [];
  for (const s of sources) {
    dist[s] = 0;
    queue.push(s);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    for (const n of map.cells[cur].neighbors) {
      if (dist[n] !== Infinity || !passable(n)) continue;
      dist[n] = dist[cur] + 1;
      queue.push(n);
    }
  }
  return dist;
}
