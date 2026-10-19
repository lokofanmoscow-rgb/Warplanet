import { applyAction, newBudget } from '../actions';
import { playerIncome, targetHappiness, happinessTarget, tradePartners } from '../economy';
import { resolveTurn } from '../turn';
import { atWar, warError, warWeariness } from '../war';
import { blankState, makeMap, ordersFor, own } from './helpers';

// Суша 0-1-2-3 в линию.
const map = makeMap('peace', [{ n: [1] }, { n: [2] }, { n: [3] }, { n: [] }], [0, 3]);

describe('мир и перемирие', () => {
  const setup = () => {
    const s = blankState(map);
    own(s, 0, 0, 10);
    own(s, 1, 1, 10);
    own(s, 3, 1, 5);
    return s;
  };

  test('предложение живёт ход: принято — мир и перемирие, не принято — пропадает', () => {
    const s = setup();
    const offered = resolveTurn(s, ordersFor(s, { 0: { peace: [1] } }));
    expect(offered.peaceOffers).toEqual([[0, 1]]);
    expect(offered.log).toContainEqual({ t: 'peaceOffer', player: 0, target: 1 });
    expect(atWar(offered, 0, 1)).toBe(true);

    expect(resolveTurn(offered, ordersFor(offered, {})).peaceOffers).toEqual([]);

    const peace = resolveTurn(offered, ordersFor(offered, { 1: { peace: [0] } }));
    expect(atWar(peace, 0, 1)).toBe(false);
    expect(peace.log).toContainEqual({ t: 'peace', a: 0, b: 1, until: 13 });
    expect(warError(peace, 0, 1)).toMatch(/Перемирие до хода 13/);
    peace.turn = 13;
    expect(warError(peace, 0, 1)).toBeNull();
  });

  test('оба предложили в одном ходу — мир сразу, атаки этого хода не проходят', () => {
    const s = setup();
    const next = resolveTurn(s, ordersFor(s, { 0: { peace: [1], moves: [{ from: 0, to: 1, count: 10 }] }, 1: { peace: [0] } }));
    expect(atWar(next, 0, 1)).toBe(false);
    expect(next.cells[1]).toMatchObject({ owner: 1, troops: 10 });
    expect(next.cells[0].troops).toBe(10);
  });

  test('усталость от войны: у обеих сторон, растёт со временем, есть предел', () => {
    const s = setup();
    s.wars = [];
    const war = resolveTurn(s, ordersFor(s, { 0: { wars: [1] } }));
    expect(warWeariness(war, 0)).toBe(2);
    expect(warWeariness(war, 1)).toBe(2);
    expect(targetHappiness(war, 1)).toBe(happinessTarget(war.players[1].tax) - 2);
    war.turn += 8;
    expect(warWeariness(war, 0)).toBe(4);
    war.turn += 100;
    expect(warWeariness(war, 0)).toBe(8);
  });

  test('торговля: мирный сосед даёт +8% дохода, война её обрывает', () => {
    const s = setup();
    s.cells[0].pop = 100000;
    s.players[0].tax = 50;
    expect(playerIncome(s, map, 0, 50)).toBe(50);
    s.wars = [];
    expect(tradePartners(s, map, 0)).toEqual([1]);
    expect(playerIncome(s, map, 0, 50)).toBe(54);
  });

  test('хозяйство: +25% дохода за уровень, растущая цена, при захвате теряется уровень', () => {
    const s = setup();
    s.cells[0].pop = 100000;
    s.players[0].gold = 1000;
    const b = newBudget(s, map, 0);
    expect(applyAction(s, map, 0, { type: 'develop', cell: 0 }, b)).toBeNull();
    expect(s.players[0].gold).toBe(960);
    expect(applyAction(s, map, 0, { type: 'develop', cell: 0 }, b)).toMatch(/Уже есть/);
    const b2 = newBudget(s, map, 0);
    expect(applyAction(s, map, 0, { type: 'develop', cell: 0 }, b2)).toBeNull();
    expect(s.players[0].gold).toBe(880);
    expect(s.cells[0].dev).toBe(2);
    expect(playerIncome(s, map, 0, 50)).toBe(75);

    own(s, 0, 0, 0);
    own(s, 1, 1, 30);
    const next = resolveTurn(s, ordersFor(s, { 1: { moves: [{ from: 1, to: 0, count: 30 }] } }));
    expect(next.cells[0].owner).toBe(1);
    expect(next.cells[0].dev).toBe(1);
  });

  test('статистика по ходам: армия, золото, доход', () => {
    const s = setup();
    s.stats = { army: [[10, 15]], gold: [[1000, 1000]], income: [[0, 0]] };
    const next = resolveTurn(s, ordersFor(s, {}));
    expect(next.stats!.army).toHaveLength(2);
    expect(next.stats!.army[1]).toEqual([10, 15]);
    expect(next.stats!.gold[1][0]).toBe(next.players[0].gold);
  });
});
