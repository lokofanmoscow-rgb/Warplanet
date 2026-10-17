import { Rng } from '../rng';
import { applyRevolts, rebelsFor, revoltChance } from '../revolt';
import type { TurnEvent } from '../types';
import { blankState, lineMap, own } from './helpers';

describe('восстания', () => {
  const map = lineMap();

  test('бывают только при счастье ниже 40%, чем несчастнее — тем чаще', () => {
    expect(revoltChance(40)).toBe(0);
    expect(revoltChance(70)).toBe(0);
    expect(revoltChance(30)).toBeCloseTo(0.15);
    expect(revoltChance(0)).toBeCloseTo(0.6);
    expect(rebelsFor(14000)).toBe(20);
  });

  test('без гарнизона провинция становится ничейной с армией повстанцев', () => {
    const s = blankState(map);
    own(s, 0, 0, 0);
    s.cells[0].pop = 14000;
    s.cells[0].happiness = 0;
    s.players[0].capital = 0;
    const rng = new Rng(1);
    rng.next = () => 0; // восстание точно случается
    const log: TurnEvent[] = [];
    applyRevolts(s, map, rng, log);
    expect(s.cells[0]).toMatchObject({ owner: null, troops: 20 });
    expect(s.players[0].capital).toBeNull();
    expect(log).toContainEqual(expect.objectContaining({ t: 'revolt', cell: 0, player: 0, suppressed: false }));
    expect(log).toContainEqual({ t: 'capitalLost', cell: 0, player: 0 });
  });

  test('сильный гарнизон подавляет восстание', () => {
    const s = blankState(map);
    own(s, 0, 0, 100);
    s.cells[0].pop = 14000;
    s.cells[0].happiness = 0;
    const rng = new Rng(1);
    const range = rng.range.bind(rng);
    rng.next = () => 0;
    rng.range = (a, b) => range(a, b);
    const log: TurnEvent[] = [];
    applyRevolts(s, map, rng, log);
    expect(s.cells[0].owner).toBe(0);
    expect(s.cells[0].troops).toBe(90);
    expect(log[0]).toMatchObject({ t: 'revolt', suppressed: true, rebels: 20, garrison: 100 });
  });

  test('довольная провинция не восстаёт', () => {
    const s = blankState(map);
    own(s, 0, 0, 0);
    s.cells[0].happiness = 40;
    const log: TurnEvent[] = [];
    applyRevolts(s, map, new Rng(3), log);
    expect(s.cells[0].owner).toBe(0);
    expect(log).toEqual([]);
  });
});
