import { applyAction, newBudget } from '../actions';
import { playerUpkeep } from '../economy';
import { reachable } from '../movement';
import { simulatePlan } from '../plan';
import { resolveTurn } from '../turn';
import type { GameState } from '../types';
import { fortAgainst, squadOf, takeLosses, takeShare } from '../units';
import { blankState, makeMap, orders, ordersFor, own } from './helpers';

// Суша 0-1-2-…-9 в линию.
const map = makeMap(
  'units',
  Array.from({ length: 10 }, (_, i) => ({ n: i < 9 ? [i + 1] : [] })),
  [0, 9],
);

/** Армия в клетке: пехота, кавалерия, артиллерия. */
function army(s: GameState, cell: number, owner: number | null, inf: number, cav = 0, art = 0): void {
  own(s, cell, owner, inf + cav + art);
  s.cells[cell].cav = cav;
  s.cells[cell].art = art;
}

describe('типы войск', () => {
  test('найм по типам: своя цена, по одному найму каждого типа на провинцию', () => {
    const s = blankState(map);
    own(s, 0, 0);
    s.players[0].gold = 100;
    const b = newBudget(s, map, 0);
    expect(applyAction(s, map, 0, { type: 'recruit', cell: 0, count: 5, unit: 'cav' }, b)).toBeNull();
    expect(applyAction(s, map, 0, { type: 'recruit', cell: 0, count: 4, unit: 'art' }, b)).toBeNull();
    expect(applyAction(s, map, 0, { type: 'recruit', cell: 0, count: 3 }, b)).toBeNull();
    expect(squadOf(s.cells[0])).toEqual({ inf: 3, cav: 5, art: 4 });
    expect(s.players[0].gold).toBe(100 - 5 * 4 - 4 * 5 - 3 * 2);
    expect(applyAction(s, map, 0, { type: 'recruit', cell: 0, count: 1, unit: 'cav' }, b)).toMatch(/Уже есть/);
  });

  test('дальность: кавалерия 6, пехота 4, артиллерия 3; смешанная армия идёт по самым медленным', () => {
    const s = blankState(map);
    for (let i = 0; i <= 8; i++) own(s, i, 0);
    army(s, 0, 0, 10, 10, 10);
    expect(reachable(s, map, 0, 0).has(6)).toBe(true);
    const plan = simulatePlan(
      s,
      0,
      orders({
        moves: [
          { from: 0, to: 6, count: 10, cav: 10 },
          { from: 0, to: 6, count: 5 },
          { from: 0, to: 4, count: 5 },
          { from: 0, to: 4, count: 5, art: 5 },
          { from: 0, to: 3, count: 5, art: 5 },
        ],
      }),
    );
    // Кавалерия уже ушла — пехоте на 6 клеток не дойти; пушкам на 4 — тоже, хотя пехота дошла бы.
    expect(plan.moveErrors).toEqual([null, expect.stringMatching(/пехота — до 4/), null, expect.stringMatching(/медленных/), null]);
    expect(plan.availableUnits[0]).toEqual({ inf: 5, cav: 0, art: 5 });
    expect(squadOf(plan.projected.cells[6])).toEqual({ inf: 0, cav: 10, art: 0 });
    expect(squadOf(plan.projected.cells[3])).toEqual({ inf: 0, cav: 0, art: 5 });
  });

  test('кавалерия сильнее в атаке; потери победителя — сначала пехота', () => {
    const weak = blankState(map);
    army(weak, 0, 0, 10);
    army(weak, 1, null, 12);
    expect(resolveTurn(weak, ordersFor(weak, { 0: { moves: [{ from: 0, to: 1, count: 10 }] } })).cells[1].owner).toBeNull();

    const riders = blankState(map);
    army(riders, 0, 0, 0, 10);
    army(riders, 1, null, 12);
    expect(resolveTurn(riders, ordersFor(riders, { 0: { moves: [{ from: 0, to: 1, count: 10, cav: 10 }] } })).cells[1].owner).toBe(0);

    const mixed = blankState(map);
    army(mixed, 0, 0, 10, 10);
    army(mixed, 1, null, 10);
    const next = resolveTurn(mixed, ordersFor(mixed, { 0: { moves: [{ from: 0, to: 1, count: 20, cav: 10 }] } }));
    expect(next.cells[1].owner).toBe(0);
    const left = squadOf(next.cells[1]);
    expect(left.cav).toBe(10);
    expect(left.inf).toBeLessThan(10);
  });

  test('артиллерия снимает укрепление', () => {
    expect(fortAgainst(2, { inf: 10, cav: 0, art: 0 })).toBe(2);
    expect(fortAgainst(2, { inf: 9, cav: 0, art: 1 })).toBeCloseTo(1.5);
    expect(fortAgainst(2, { inf: 8, cav: 0, art: 2 })).toBe(1);

    const plain = blankState(map);
    army(plain, 0, 0, 16);
    army(plain, 1, 1, 10);
    plain.cells[1].fortified = true;
    expect(resolveTurn(plain, ordersFor(plain, { 0: { moves: [{ from: 0, to: 1, count: 16 }] } })).cells[1].owner).toBe(1);

    const guns = blankState(map);
    army(guns, 0, 0, 12, 0, 4);
    army(guns, 1, 1, 10);
    guns.cells[1].fortified = true;
    expect(resolveTurn(guns, ordersFor(guns, { 0: { moves: [{ from: 0, to: 1, count: 16, art: 4 }] } })).cells[1].owner).toBe(0);
  });

  test('содержание: кавалерия и артиллерия вдвое дороже пехоты', () => {
    const s = blankState(map);
    army(s, 0, 0, 10);
    expect(playerUpkeep(s, map, 0)).toBe(1);
    army(s, 0, 0, 10, 10, 10);
    expect(playerUpkeep(s, map, 0)).toBe(5);
  });

  test('потери: в бою — сначала пехота, без жалования — поровну', () => {
    expect(takeLosses({ inf: 2, cav: 5, art: 5 }, 4)).toEqual({ inf: 0, cav: 3, art: 5 });
    expect(takeShare({ inf: 10, cav: 10, art: 0 }, 4)).toEqual({ inf: 8, cav: 8, art: 0 });
  });

  test('старое сохранение без состава армии — вся армия пехота', () => {
    expect(squadOf({ owner: 0, troops: 7, pop: 1000, happiness: 50, fortified: false })).toEqual({ inf: 7, cav: 0, art: 0 });
  });
});
