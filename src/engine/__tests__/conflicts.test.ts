import { resolveTurn } from '../turn';
import type { TurnEvent } from '../types';
import { blankState, lineMap, makeMap, own, ordersFor } from './helpers';

type Battle = Extract<TurnEvent, { t: 'battle' }>;
const battles = (log: TurnEvent[]) => log.filter((e): e is Battle => e.t === 'battle');

describe('конфликты одновременных ходов', () => {
  test('встречное движение через одну границу — бой на границе, победитель продолжает путь', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 1, 0, 100);
    own(s, 2, 1, 40);
    own(s, 5, 1, 1);
    const next = resolveTurn(
      s,
      ordersFor(s, {
        0: { moves: [{ from: 1, to: 2, count: 100 }] },
        1: { moves: [{ from: 2, to: 1, count: 40 }] },
      }),
    );
    const b = battles(next.log);
    expect(b[0].border).toBe(true);
    expect(b[0].winner).toBe(0);
    // Пустую провинцию 2 победитель занимает без боя.
    expect(b).toHaveLength(1);
    expect(next.cells[2].owner).toBe(0);
    expect(next.cells[2].troops).toBe(b[0].attackerLeft);
    // Проигравший не дошёл до провинции 1.
    expect(next.cells[1].owner).toBe(0);
    expect(next.cells[1].troops).toBe(0);
  });

  test('несколько игроков атакуют одну провинцию: сначала атакующие между собой, от слабейшего', () => {
    const map = makeMap('star', [{ n: [3] }, { n: [3] }, { n: [3] }, { n: [] }], [0, 1, 2, 3]);
    const s = blankState(map, 4);
    own(s, 0, 0, 30);
    own(s, 1, 1, 100);
    own(s, 2, 2, 60);
    own(s, 3, 3, 20);
    const next = resolveTurn(
      s,
      ordersFor(s, {
        0: { moves: [{ from: 0, to: 3, count: 30 }] },
        1: { moves: [{ from: 1, to: 3, count: 100 }] },
        2: { moves: [{ from: 2, to: 3, count: 60 }] },
      }),
    );
    const b = battles(next.log);
    expect(b).toHaveLength(3);
    // 30 против 60, выживший против 100, затем против гарнизона 20.
    expect([b[0].attack, b[0].defense].sort((x, y) => x - y)).toEqual([30, 60]);
    expect(b[1].attack).toBe(100);
    expect(b[2].defender).toBe(3);
    expect(b[2].attacker).toBe(1);
    expect(next.cells[3].owner).toBe(1);
  });

  test('провинция без армии захватывается вошедшим без боя', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 10);
    own(s, 1, 1, 0);
    own(s, 5, 1, 1);
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 10 }] } }));
    expect(battles(next.log)).toHaveLength(0);
    expect(next.cells[1]).toMatchObject({ owner: 0, troops: 10 });
  });

  test('если в пустую провинцию вошли несколько игроков — сначала бой между ними', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 50);
    own(s, 2, 1, 20);
    s.cells[1].troops = 0; // нейтральная без ополчения
    const next = resolveTurn(
      s,
      ordersFor(s, {
        0: { moves: [{ from: 0, to: 1, count: 50 }] },
        1: { moves: [{ from: 2, to: 1, count: 20 }] },
      }),
    );
    const b = battles(next.log);
    expect(b).toHaveLength(1);
    expect(b[0].border).toBeUndefined();
    expect(b[0].winner).toBe(0);
    expect(next.cells[1].owner).toBe(0);
    expect(next.cells[1].troops).toBe(b[0].attackerLeft);
  });

  test('армия, ушедшая из провинции, не защищает её', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 30);
    own(s, 1, 1, 50);
    own(s, 2, 1, 0);
    own(s, 5, 1, 1);
    const next = resolveTurn(
      s,
      ordersFor(s, {
        0: { moves: [{ from: 0, to: 1, count: 30 }] },
        1: { moves: [{ from: 1, to: 2, count: 50 }] },
      }),
    );
    expect(battles(next.log)).toHaveLength(0);
    expect(next.cells[1]).toMatchObject({ owner: 0, troops: 30 });
    expect(next.cells[2]).toMatchObject({ owner: 1, troops: 50 });
  });

  test('подкрепление, пришедшее в свою провинцию, защищает её вместе с гарнизоном', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 60);
    own(s, 1, 1, 10);
    own(s, 2, 1, 50);
    own(s, 5, 1, 1);
    const next = resolveTurn(
      s,
      ordersFor(s, {
        0: { moves: [{ from: 0, to: 1, count: 60 }] },
        1: { moves: [{ from: 2, to: 1, count: 50 }] },
      }),
    );
    const b = battles(next.log);
    expect(b).toHaveLength(1);
    expect(b[0].defense).toBe(60);
  });

  test('армия разделяется: часть остаётся, часть уходит', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 1, 0, 50);
    own(s, 5, 1, 1);
    const next = resolveTurn(
      s,
      ordersFor(s, {
        0: {
          moves: [
            { from: 1, to: 0, count: 20 },
            { from: 1, to: 2, count: 10 },
          ],
        },
      }),
    );
    expect(next.cells[1].troops).toBe(20);
    expect(next.cells[0]).toMatchObject({ owner: 0, troops: 20 });
    expect(next.cells[2]).toMatchObject({ owner: 0, troops: 10 });
  });

  test('приказ на большее число солдат урезается до доступного', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 10);
    own(s, 5, 1, 1);
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 999 }] } }));
    expect(next.cells[1]).toMatchObject({ owner: 0, troops: 10 });
  });
});

describe('флот', () => {
  test('армия заходит в соседнюю морскую зону как на обычную клетку', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 1, 0, 30);
    own(s, 5, 1, 1);
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 1, to: 6, count: 30 }] } }));
    expect(next.cells[6]).toMatchObject({ owner: 0, troops: 30 });
    // провинция остаётся за игроком без армии
    expect(next.cells[1]).toMatchObject({ owner: 0, troops: 0 });
  });

  test('морская зона освобождается, когда флот уходит', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 6, 0, 30);
    own(s, 0, 0, 1);
    own(s, 5, 1, 1);
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 6, to: 7, count: 30 }] } }));
    expect(next.cells[6]).toMatchObject({ owner: null, troops: 0 });
    expect(next.cells[7]).toMatchObject({ owner: 0, troops: 30 });
  });

  test('две вражеские армии в одной морской зоне сражаются, в море сила ×0,5', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 6, 0, 40);
    own(s, 0, 0, 1);
    own(s, 4, 1, 100);
    const next = resolveTurn(s, ordersFor(s, { 1: { moves: [{ from: 4, to: 7, count: 100 }] }, 0: { moves: [{ from: 6, to: 7, count: 40 }] } }));
    const b = battles(next.log)[0];
    expect(b.attackPower).toBeLessThanOrEqual(100 * 0.5 * 1.05);
    expect(b.attackPower).toBeGreaterThanOrEqual(40 * 0.5 * 0.95);
    expect(next.cells[7].owner).toBe(1);
  });

  test('высадка — обычная атака прибрежной провинции, без морского штрафа', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 7, 0, 60);
    own(s, 0, 0, 1);
    own(s, 4, 1, 50);
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 7, to: 4, count: 60 }] } }));
    const b = battles(next.log)[0];
    expect(b.attackPower).toBeGreaterThanOrEqual(60 * 0.95);
    expect(next.cells[4].owner).toBe(0);
  });
});
