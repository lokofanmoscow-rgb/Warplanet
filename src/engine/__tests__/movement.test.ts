import { applyAction, festivalCost, newBudget } from '../actions';
import { happinessTarget, nextHappiness } from '../economy';
import { reachable } from '../movement';
import { sanitizeOrders, simulatePlan } from '../plan';
import { resolveTurn } from '../turn';
import type { TurnEvent } from '../types';
import { visibleCells } from '../vision';
import { atWar } from '../war';
import { blankState, makeMap, own, orders, ordersFor } from './helpers';

type Battle = Extract<TurnEvent, { t: 'battle' }>;
const battles = (log: TurnEvent[]) => log.filter((e): e is Battle => e.t === 'battle');

/**
 * Суша 0-1-2-3-4-5-6-7 и море 8-…-15 вдоль неё:
 *   8 у берега провинции 0, 15 — у провинции 7.
 */
const map = makeMap(
  'range',
  [
    { n: [1, 8] },
    { n: [2] },
    { n: [3] },
    { n: [4] },
    { n: [5] },
    { n: [6] },
    { n: [7] },
    { n: [15] },
    ...Array.from({ length: 8 }, (_, i) => ({ kind: 'sea' as const, n: i < 7 ? [9 + i] : [] })),
  ],
  [0, 7],
);

describe('перемещения', () => {
  test('по своей земле — до 4 клеток за ход, армия сразу на месте и дальше в этом ходу не идёт', () => {
    const s = blankState(map);
    for (let i = 0; i <= 5; i++) own(s, i, 0);
    s.cells[0].troops = 20;
    expect(reachable(s, map, 0, 0).get(4)).toEqual({ kind: 'march', path: [0, 1, 2, 3, 4] });
    const plan = simulatePlan(s, 0, orders({ tax: 60, moves: [{ from: 0, to: 4, count: 10 }, { from: 0, to: 5, count: 1 }] }));
    expect(plan.moveErrors[0]).toBeNull();
    expect(plan.moveErrors[1]).toMatch(/пехота — до 4/);
    expect(plan.projected.cells[4].troops).toBe(10);
    expect(plan.projected.cells[0].troops).toBe(10);
    expect(plan.available[4]).toBe(0);
    expect(plan.available[0]).toBe(10);
  });

  test('в чужую провинцию — только в соседнюю с вашей землёй, дальше по одной за ход', () => {
    const s = blankState(map);
    for (let i = 0; i <= 2; i++) own(s, i, 0);
    s.cells[0].troops = 20;
    own(s, 7, 1, 1);
    const reach = reachable(s, map, 0, 0);
    expect(reach.get(3)).toEqual({ kind: 'attack', path: [0, 1, 2, 3] });
    expect(reach.has(4)).toBe(false);
    const plan = simulatePlan(s, 0, orders({ tax: 60, moves: [{ from: 0, to: 4, count: 5 }] }));
    expect(plan.moveErrors[0]).toMatch(/только в соседнюю/);

    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 3, count: 20 }] } }));
    expect(next.cells[3]).toMatchObject({ owner: 0, troops: 20 });
    expect(reachable(next, map, 0, 3).has(4)).toBe(true);
    expect(reachable(next, map, 0, 3).has(5)).toBe(false);
  });

  test('каждое перемещение стоит 0,5 ОД', () => {
    const s = blankState(map);
    for (let i = 0; i <= 3; i++) own(s, i, 0);
    s.cells[0].troops = 20;
    const moves = Array.from({ length: 11 }, () => ({ from: 0, to: 1, count: 1 }));
    const plan = simulatePlan(s, 0, orders({ tax: 60, moves }));
    expect(plan.apTotal).toBe(5);
    expect(plan.moveErrors.slice(0, 10)).toEqual(Array(10).fill(null));
    expect(plan.moveErrors[10]).toMatch(/очков действия/);
    expect(plan.apLeft).toBe(0);
    // При расчёте хода лишний приказ тоже не выполняется.
    const next = resolveTurn(s, ordersFor(s, { 0: { moves } }));
    expect(next.cells[1].troops).toBe(10);
  });

  test('посадка на корабли стоит 2 золота за солдата', () => {
    const s = blankState(map);
    own(s, 0, 0, 30);
    s.players[0].gold = 20;
    const base = simulatePlan(s, 0, orders({ tax: 60 })).goldLeft;
    const tooMany = Math.floor(base / 2) + 1;
    const bad = simulatePlan(s, 0, orders({ tax: 60, moves: [{ from: 0, to: 8, count: tooMany }] }));
    expect(bad.moveErrors[0]).toMatch(/золота на корабли/);
    const ok = simulatePlan(s, 0, orders({ tax: 60, moves: [{ from: 0, to: 8, count: 2 }] }));
    expect(ok.moveErrors[0]).toBeNull();
    expect(ok.goldLeft).toBe(base - 4);
    expect(ok.projected.cells[8]).toMatchObject({ owner: 0, troops: 2 });
  });

  test('флот проходит до 5 морских клеток, высадка — последним шагом', () => {
    const s = blankState(map);
    own(s, 0, 0, 1);
    own(s, 8, 0, 20);
    const fromStart = reachable(s, map, 0, 8);
    expect(fromStart.get(13)?.kind).toBe('sail');
    expect(fromStart.has(14)).toBe(false);
    own(s, 11, 0, 20);
    own(s, 8, null, 0);
    const reach = reachable(s, map, 0, 11);
    expect(reach.get(7)).toEqual({ kind: 'attack', path: [11, 12, 13, 14, 15, 7] });
  });

  test('чужой флот не обойти, без войны и не атаковать', () => {
    const s = blankState(map);
    s.wars = [];
    own(s, 0, 0, 1);
    own(s, 7, 1, 1);
    own(s, 8, 0, 20);
    own(s, 10, 1, 5);
    expect([...reachable(s, map, 0, 8).keys()].sort((a, b) => a - b)).toEqual([0, 9]);
    s.wars = [[0, 1]];
    expect(reachable(s, map, 0, 8).get(10)?.kind).toBe('naval');
    expect(reachable(s, map, 0, 8).has(11)).toBe(false);
  });

  test('в бою записано, откуда армия вошла в клетку', () => {
    const s = blankState(map);
    for (let i = 0; i <= 2; i++) own(s, i, 0);
    s.cells[0].troops = 30;
    own(s, 3, 1, 5);
    own(s, 7, 1, 1);
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 3, count: 30 }] } }));
    const b = battles(next.log);
    expect(b).toHaveLength(1);
    expect(b[0].fromCells).toEqual([2]);
    expect(next.cells[3].owner).toBe(0);
  });
});

describe('объявление войны', () => {
  const setup = () => {
    const s = blankState(map);
    s.wars = [];
    own(s, 0, 0, 30);
    own(s, 1, 1, 10);
    own(s, 7, 1, 1);
    return s;
  };

  test('без войны в чужую страну не пойти', () => {
    const s = setup();
    const plan = simulatePlan(s, 0, orders({ tax: 60, moves: [{ from: 0, to: 1, count: 30 }] }));
    expect(plan.moveErrors[0]).toMatch(/Сначала объявите войну/);
  });

  test('объявить и пойти можно в одном ходу; счастье падает только у объявившего', () => {
    const s = setup();
    const o = { wars: [1], moves: [{ from: 0, to: 1, count: 30 }] };
    const plan = simulatePlan(s, 0, orders({ tax: 60, ...o }));
    expect(plan.warErrors).toEqual([null]);
    expect(plan.moveErrors).toEqual([null]);
    expect(plan.projected.cells[0].happiness).toBe(60);
    expect(plan.projected.cells[7].happiness).toBe(70);

    const next = resolveTurn(s, ordersFor(s, { 0: o }));
    expect(atWar(next, 0, 1)).toBe(true);
    expect(atWar(next, 1, 0)).toBe(true);
    expect(next.log).toContainEqual({ t: 'war', player: 0, target: 1 });
    expect(next.cells[1].owner).toBe(0);
    // Тот, на кого напали, счастья не теряет: оно идёт к цели налога, как обычно.
    expect(next.cells[7].happiness).toBe(Math.round(nextHappiness(70, happinessTarget(60))));
    // Захваченная: 40%, затем шаг к цели налога.
    expect(next.cells[1].happiness).toBe(45);
  });

  test('на кого напали, отвечает без объявления', () => {
    const s = setup();
    s.wars = [[0, 1]];
    s.cells[1].troops = 50;
    const plan = simulatePlan(s, 1, orders({ tax: 60, moves: [{ from: 1, to: 0, count: 50 }] }));
    expect(plan.moveErrors).toEqual([null]);
  });

  test('хост отбрасывает лишние объявления', () => {
    const s = setup();
    s.wars = [[0, 1]];
    const clean = sanitizeOrders(s, 0, { tax: 60, actions: [], moves: [], wars: [1, 0, 5, 'x'] });
    expect(clean.wars).toEqual([]);
  });
});

describe('праздник', () => {
  test('+20 счастья за золото и 0,5 ОД, не больше 100%', () => {
    const s = blankState(map);
    own(s, 0, 0, 0);
    s.cells[0].pop = 30000;
    s.cells[0].happiness = 50;
    s.players[0].gold = 100;
    const b = newBudget(s, map, 0);
    expect(festivalCost(30000)).toBe(15);
    expect(festivalCost(1000)).toBe(5);
    expect(applyAction(s, map, 0, { type: 'festival', cell: 0 }, b)).toBeNull();
    expect(s.cells[0].happiness).toBe(70);
    expect(s.players[0].gold).toBe(85);
    expect(b.ap).toBe(4.5);
    expect(applyAction(s, map, 0, { type: 'festival', cell: 0 }, b)).toMatch(/Уже есть/);
    s.cells[1].owner = 0;
    s.cells[1].happiness = 100;
    expect(applyAction(s, map, 0, { type: 'festival', cell: 1 }, b)).toMatch(/100%/);
  });
});

describe('видимость', () => {
  test('армии видно в 2 клетках от своей земли и своего флота', () => {
    const s = blankState(map);
    own(s, 0, 0, 5);
    own(s, 12, 0, 3); // флот в море 12
    const v = visibleCells(s, map, 0);
    expect([0, 1, 2, 8, 9].every((c) => v.has(c))).toBe(true);
    expect(v.has(3)).toBe(false);
    expect([10, 11, 12, 13, 14].every((c) => v.has(c))).toBe(true);
    expect(v.has(15)).toBe(false);
  });
});
