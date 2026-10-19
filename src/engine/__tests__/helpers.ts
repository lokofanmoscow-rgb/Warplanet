import { registerMap } from '../map';
import { createGame } from '../setup';
import type { CellKind, GameState, MapDef, OrdersByPlayer, PlayerOrders } from '../types';

export interface CellSpec {
  kind?: CellKind;
  pop?: number;
  n: number[];
}

/** Маленькая карта для тестов. Соседство задаётся с одной стороны, вторая дописывается. */
export function makeMap(id: string, specs: CellSpec[], startPoints: number[] = [0, specs.length - 1]): MapDef {
  const neighbors = specs.map((s) => new Set(s.n));
  specs.forEach((s, i) => s.n.forEach((j) => neighbors[j].add(i)));
  const map: MapDef = {
    id,
    name: id,
    width: 100,
    height: 100,
    startPoints,
    cells: specs.map((s, i) => ({
      id: i,
      name: `C${i}`,
      kind: s.kind ?? 'land',
      neighbors: [...neighbors[i]].sort((a, b) => a - b),
      pop: (s.kind ?? 'land') === 'land' ? (s.pop ?? 10000) : 0,
      center: [i * 10, 0],
      rings: [],
    })),
  };
  registerMap(map);
  return map;
}

/**
 * Линейная карта 0-1-2-3-4-5 с морем:
 *   0 — 1 — 2 — 3 — 4 — 5
 *       |           |
 *       6(море) —  7(море)
 */
export function lineMap(): MapDef {
  return makeMap(
    'line',
    [
      { n: [1] },
      { n: [2, 6] },
      { n: [3] },
      { n: [4] },
      { n: [5, 7] },
      { n: [] },
      { kind: 'sea', n: [7] },
      { kind: 'sea', n: [] },
    ],
    [0, 5],
  );
}

/** Пустое состояние: всё нейтрально без ополчения, у игроков хватает золота на содержание. */
export function blankState(map: MapDef, players = 2): GameState {
  const state = createGame({
    map,
    seed: 42,
    players: Array.from({ length: players }, (_, i) => ({ name: `P${i}`, kind: 'human' as const, start: map.startPoints[i] })),
  });
  for (const c of state.cells) {
    c.owner = null;
    c.troops = 0;
    c.happiness = 70;
    c.fortified = false;
  }
  state.players.forEach((p) => {
    p.gold = 1000;
    p.capital = null;
  });
  // В тестах боёв все воюют со всеми; тесты объявления войны сбрасывают это сами.
  state.wars = [];
  for (let a = 0; a < players; a++) for (let b = a + 1; b < players; b++) state.wars.push([a, b]);
  return state;
}

export function own(state: GameState, cell: number, owner: number | null, troops = 0): void {
  state.cells[cell].owner = owner;
  state.cells[cell].troops = troops;
}

export function orders(partial: Partial<PlayerOrders> & { tax?: number }): PlayerOrders {
  return {
    tax: partial.tax ?? 0,
    actions: partial.actions ?? [],
    moves: partial.moves ?? [],
    wars: partial.wars ?? [],
    peace: partial.peace ?? [],
  };
}

export function ordersFor(state: GameState, map: Record<number, Partial<PlayerOrders>>): OrdersByPlayer {
  const out: OrdersByPlayer = {};
  for (const p of state.players) {
    out[p.id] = orders({ tax: p.tax, ...(map[p.id] ?? {}) });
  }
  return out;
}
