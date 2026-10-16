import { actionPoints, applyAction, buyCost, maxRecruit, newBudget } from '../actions';
import { simulatePlan, sanitizeOrders } from '../plan';
import { resolveTurn } from '../turn';
import { blankState, lineMap, makeMap, own, orders, ordersFor } from './helpers';

describe('очки действия и действия в провинциях', () => {
  const map = lineMap();

  test('5 ОД плюс 1 за каждые 10 своих провинций', () => {
    const big = makeMap('big', Array.from({ length: 25 }, (_, i) => ({ n: i < 24 ? [i + 1] : [] })));
    const s = blankState(big);
    for (let i = 0; i < 9; i++) own(s, i, 0);
    expect(actionPoints(s, big, 0)).toBe(5);
    own(s, 9, 0);
    expect(actionPoints(s, big, 0)).toBe(6);
    for (let i = 10; i < 20; i++) own(s, i, 0);
    expect(actionPoints(s, big, 0)).toBe(7);
  });

  test('найм: 2 золота и 100 жителей за солдата, не больше 10% населения за раз', () => {
    const s = blankState(map);
    own(s, 0, 0, 5);
    s.cells[0].pop = 20000;
    s.players[0].gold = 100;
    expect(maxRecruit(20000)).toBe(20);
    const b = newBudget(s, map, 0);
    expect(applyAction(s, map, 0, { type: 'recruit', cell: 0, count: 21 }, b)).not.toBeNull();
    expect(applyAction(s, map, 0, { type: 'recruit', cell: 0, count: 20 }, b)).toBeNull();
    expect(s.cells[0].troops).toBe(25);
    expect(s.cells[0].pop).toBe(18000);
    expect(s.players[0].gold).toBe(60);
    expect(b.ap).toBe(4);
  });

  test('найм только в своей провинции и при наличии золота', () => {
    const s = blankState(map);
    own(s, 0, 0);
    own(s, 1, 1);
    s.players[0].gold = 5;
    const b = newBudget(s, map, 0);
    expect(applyAction(s, map, 0, { type: 'recruit', cell: 1, count: 1 }, b)).toMatch(/своей/);
    expect(applyAction(s, map, 0, { type: 'recruit', cell: 0, count: 3 }, b)).toMatch(/золота/);
  });

  test('укрепление: 2 ОД и 30 золота, одно на провинцию', () => {
    const s = blankState(map);
    own(s, 0, 0);
    s.players[0].gold = 100;
    const b = newBudget(s, map, 0);
    expect(applyAction(s, map, 0, { type: 'fortify', cell: 0 }, b)).toBeNull();
    expect(s.cells[0].fortified).toBe(true);
    expect(s.players[0].gold).toBe(70);
    expect(b.ap).toBe(3);
    const b2 = newBudget(s, map, 0);
    expect(applyAction(s, map, 0, { type: 'fortify', cell: 0 }, b2)).toMatch(/уже укреплена/);
  });

  test('укрепление пропадает при захвате', () => {
    const s = blankState(map);
    own(s, 0, 0, 100);
    own(s, 1, 1, 0);
    s.cells[1].fortified = true;
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 100 }] } }));
    expect(next.cells[1].owner).toBe(0);
    expect(next.cells[1].fortified).toBe(false);
  });

  test('покупка нейтральной: соседняя с твоей, цена население / 200', () => {
    const s = blankState(map);
    own(s, 0, 0);
    s.cells[1].pop = 10000;
    s.cells[1].troops = 10;
    s.cells[2].pop = 10000;
    s.players[0].gold = 200;
    expect(buyCost(10000)).toBe(50);
    const b = newBudget(s, map, 0);
    expect(applyAction(s, map, 0, { type: 'buy', cell: 2 }, b)).toMatch(/граничить/);
    expect(applyAction(s, map, 0, { type: 'buy', cell: 1 }, b)).toBeNull();
    expect(s.cells[1].owner).toBe(0);
    expect(s.cells[1].troops).toBe(0);
    expect(s.players[0].gold).toBe(150);
  });

  test('купить можно только нейтральную', () => {
    const s = blankState(map);
    own(s, 0, 0);
    own(s, 1, 1);
    s.players[0].gold = 1000;
    expect(applyAction(s, map, 0, { type: 'buy', cell: 1 }, newBudget(s, map, 0))).toMatch(/нейтральную/);
  });

  test('мародёрство: +население/200 золота, население −10%, счастье −20', () => {
    const s = blankState(map);
    own(s, 0, 0);
    s.cells[0].pop = 30000;
    s.cells[0].happiness = 70;
    s.players[0].gold = 0;
    const b = newBudget(s, map, 0);
    expect(applyAction(s, map, 0, { type: 'loot', cell: 0 }, b)).toBeNull();
    expect(s.players[0].gold).toBe(150);
    expect(s.cells[0].pop).toBe(27000);
    expect(s.cells[0].happiness).toBe(50);
  });

  test('одна провинция — не больше одного действия каждого типа за ход', () => {
    const s = blankState(map);
    own(s, 0, 0);
    s.cells[0].pop = 50000;
    s.players[0].gold = 1000;
    const b = newBudget(s, map, 0);
    expect(applyAction(s, map, 0, { type: 'recruit', cell: 0, count: 5 }, b)).toBeNull();
    expect(applyAction(s, map, 0, { type: 'recruit', cell: 0, count: 5 }, b)).toMatch(/Уже есть/);
    expect(applyAction(s, map, 0, { type: 'loot', cell: 0 }, b)).toBeNull();
  });

  test('ОД не бесконечны', () => {
    const s = blankState(map);
    for (let i = 0; i < 5; i++) own(s, i, 0);
    s.players[0].gold = 1000;
    const b = newBudget(s, map, 0);
    expect(b.ap).toBe(5);
    expect(applyAction(s, map, 0, { type: 'fortify', cell: 0 }, b)).toBeNull();
    expect(applyAction(s, map, 0, { type: 'fortify', cell: 1 }, b)).toBeNull();
    expect(applyAction(s, map, 0, { type: 'loot', cell: 2 }, b)).toBeNull();
    expect(applyAction(s, map, 0, { type: 'loot', cell: 3 }, b)).toMatch(/очков действия/);
  });

  test('прогноз плана учитывает доход хода и даёт двигать нанятых', () => {
    const s = blankState(map);
    own(s, 0, 0, 0);
    s.cells[0].pop = 20000;
    s.players[0].gold = 0;
    const plan = simulatePlan(
      s,
      0,
      orders({ tax: 100, actions: [{ type: 'recruit', cell: 0, count: 10 }], moves: [{ from: 0, to: 1, count: 10 }] }),
    );
    // доход 20 золота → найм 10 солдат за 20
    expect(plan.economy.income).toBe(20);
    expect(plan.actionErrors).toEqual([null]);
    expect(plan.moveErrors).toEqual([null]);
    expect(plan.goldLeft).toBe(0);
    expect(plan.apLeft).toBe(4);
  });

  test('хост отбрасывает невозможные приказы клиента', () => {
    const s = blankState(map);
    own(s, 0, 0, 10);
    s.players[0].gold = 0;
    const clean = sanitizeOrders(s, 0, {
      tax: 999,
      actions: [{ type: 'fortify', cell: 0 }, { type: 'hack', cell: 0 }],
      moves: [
        { from: 0, to: 1, count: 5 },
        { from: 0, to: 3, count: 1 },
        { from: 0, to: 1, count: 50 },
      ],
    });
    expect(clean.tax).toBe(200);
    expect(clean.actions).toEqual([]);
    expect(clean.moves).toEqual([{ from: 0, to: 1, count: 5 }]);
  });
});
