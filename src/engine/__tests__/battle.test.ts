import { fight, losses } from '../battle';
import { Rng } from '../rng';
import { resolveTurn } from '../turn';
import type { TurnEvent } from '../types';
import { blankState, lineMap, makeMap, own, ordersFor } from './helpers';

type Battle = Extract<TurnEvent, { t: 'battle' }>;
const battles = (log: TurnEvent[]) => log.filter((e): e is Battle => e.t === 'battle');

describe('бой', () => {
  test('случайный множитель в пределах ±5%', () => {
    for (let seed = 1; seed < 300; seed++) {
      const r = fight(new Rng(seed), { troops: 100, strength: 1, fort: 1 }, { troops: 100, strength: 1, fort: 1 }, true);
      expect(r.aPower).toBeGreaterThanOrEqual(95);
      expect(r.aPower).toBeLessThan(105);
      expect(r.bPower).toBeGreaterThanOrEqual(95);
      expect(r.bPower).toBeLessThan(105);
    }
  });

  test('явный перевес побеждает всегда, случайность решает только близкие бои', () => {
    for (let seed = 1; seed < 200; seed++) {
      const strong = fight(new Rng(seed), { troops: 100, strength: 1, fort: 1 }, { troops: 89, strength: 1, fort: 1 }, true);
      expect(strong.winner).toBe('a');
      const weak = fight(new Rng(seed), { troops: 89, strength: 1, fort: 1 }, { troops: 100, strength: 1, fort: 1 }, true);
      expect(weak.winner).toBe('b');
    }
  });

  test('ничья в пользу защиты', () => {
    const rng = new Rng(1);
    // Подменяем случайность, чтобы силы совпали.
    rng.range = () => 1;
    const r = fight(rng, { troops: 50, strength: 1, fort: 1 }, { troops: 50, strength: 1, fort: 1 }, true);
    expect(r.winner).toBe('b');
    expect(r.aLeft).toBe(0);
    expect(r.bLeft).toBe(25);
  });

  test('потери победителя = сила проигравшего × 0,5 / укрепление, вверх', () => {
    expect(losses(41, 1)).toBe(21);
    expect(losses(40, 1)).toBe(20);
    expect(losses(40, 2)).toBe(10);
    expect(losses(41, 2)).toBe(11);
    const rng = new Rng(1);
    rng.range = () => 1;
    const r = fight(rng, { troops: 100, strength: 1, fort: 1 }, { troops: 30, strength: 1, fort: 1 }, true);
    expect(r).toMatchObject({ winner: 'a', aLeft: 85, bLeft: 0 });
  });

  test('укреплённый гарнизон защищается вдвое сильнее', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 100);
    own(s, 1, 1, 60);
    s.cells[1].fortified = true;
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 100 }] } }));
    const b = battles(next.log)[0];
    expect(b.defensePower).toBeGreaterThan(110);
    expect(b.winner).toBe(1);
    expect(next.cells[1].owner).toBe(1);
    // потери защитника делятся на 2
    expect(next.cells[1].troops).toBe(60 - Math.ceil(b.attackPower * 0.5 / 2 - 1e-9));
  });

  test('нейтральную провинцию защищает ополчение', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 5);
    own(s, 5, 1, 1);
    s.cells[1].troops = 10;
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 5 }] } }));
    expect(next.cells[1].owner).toBe(null);
    expect(next.cells[0].troops).toBe(0);
  });

  test('несколько армий одного игрока, идущих в одну провинцию, атакуют вместе', () => {
    const map = makeMap('fork', [{ n: [2] }, { n: [2] }, { n: [] }, { n: [] }], [0, 3]);
    const s = blankState(map);
    own(s, 0, 0, 40);
    own(s, 1, 0, 40);
    own(s, 2, 1, 60);
    own(s, 3, 1, 1);
    const next = resolveTurn(
      s,
      ordersFor(s, {
        0: {
          moves: [
            { from: 0, to: 2, count: 40 },
            { from: 1, to: 2, count: 40 },
          ],
        },
      }),
    );
    const b = battles(next.log);
    expect(b).toHaveLength(1);
    expect(b[0].attack).toBe(80);
    expect(next.cells[2].owner).toBe(0);
  });

  test('захваченная провинция: счастье 40%, население −10%', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 50);
    own(s, 1, 1, 0);
    own(s, 5, 1, 1);
    s.cells[1].pop = 10000;
    s.cells[1].happiness = 90;
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 50 }] } }));
    expect(next.cells[1].owner).toBe(0);
    // захват −10%, затем рост +2% не идёт: счастье 40 < 50; затем счастье к цели
    expect(next.cells[1].pop).toBe(9000);
    expect(next.cells[1].happiness).toBe(45);
    expect(next.log.some((e) => e.t === 'capture' && e.cell === 1 && e.from === 1)).toBe(true);
  });

  test('потеря столицы', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 50);
    own(s, 1, 1, 0);
    own(s, 5, 1, 1);
    s.players[1].capital = 1;
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 50 }] } }));
    expect(next.players[1].capital).toBe(null);
    expect(next.log.some((e) => e.t === 'capitalLost')).toBe(true);
  });

  test('ход воспроизводим: одинаковое состояние и приказы дают одинаковый итог', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 50);
    own(s, 1, 1, 48);
    own(s, 5, 1, 1);
    const o = ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 50 }] } });
    const a = resolveTurn(s, o);
    const b = resolveTurn(s, o);
    expect(a).toEqual(b);
    // исходное состояние не меняется
    expect(s.cells[0].troops).toBe(50);
    expect(s.turn).toBe(1);
  });
});
