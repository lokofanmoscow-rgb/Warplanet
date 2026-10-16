import {
  applyEconomy,
  applyGrowth,
  cellIncome,
  clampTax,
  happinessTarget,
  incomeFactor,
  playerIncome,
  playerUpkeep,
  previewEconomy,
} from '../economy';
import { resolveTurn } from '../turn';
import type { TurnEvent } from '../types';
import { blankState, lineMap, own, ordersFor } from './helpers';

describe('экономика', () => {
  const map = lineMap();

  test('доход провинции = население / 1000 × налог / 100 × k', () => {
    const cell = { owner: 0, troops: 0, pop: 20000, happiness: 70, fortified: false };
    expect(cellIncome(cell, 100)).toBe(20);
    expect(cellIncome(cell, 50)).toBe(10);
    expect(cellIncome({ ...cell, happiness: 50 }, 100)).toBe(20);
    expect(cellIncome({ ...cell, happiness: 49 }, 100)).toBe(5);
    expect(cellIncome({ ...cell, happiness: 25 }, 100)).toBe(5);
    expect(cellIncome({ ...cell, happiness: 24 }, 100)).toBe(0);
  });

  test('k по счастью: 1 от 50%, 0,25 при 25–49%, 0 ниже 25%', () => {
    expect(incomeFactor(100)).toBe(1);
    expect(incomeFactor(50)).toBe(1);
    expect(incomeFactor(30)).toBe(0.25);
    expect(incomeFactor(10)).toBe(0);
  });

  test('цель счастья = 100 − 0,4 × налог', () => {
    expect(happinessTarget(0)).toBe(100);
    expect(happinessTarget(100)).toBe(60);
    expect(happinessTarget(200)).toBe(20);
  });

  test('налог 0–200% с шагом 10%', () => {
    expect(clampTax(-5)).toBe(0);
    expect(clampTax(250)).toBe(200);
    expect(clampTax(74)).toBe(70);
    expect(clampTax(75)).toBe(80);
  });

  test('доход игрока суммирует провинции, ИИ получает поправку сложности', () => {
    const s = blankState(map);
    own(s, 0, 0);
    own(s, 1, 0);
    s.cells[0].pop = 20000;
    s.cells[1].pop = 10000;
    expect(playerIncome(s, map, 0, 100)).toBe(30);
    s.players[0].kind = 'ai';
    s.players[0].difficulty = 'easy';
    expect(playerIncome(s, map, 0, 100)).toBe(24);
    s.players[0].difficulty = 'hard';
    expect(playerIncome(s, map, 0, 100)).toBe(36);
  });

  test('содержание: 1 золото за 10 солдат, в море вдвое дороже', () => {
    const s = blankState(map);
    own(s, 0, 0, 30);
    expect(playerUpkeep(s, map, 0)).toBe(3);
    own(s, 6, 0, 30);
    expect(playerUpkeep(s, map, 0)).toBe(9);
  });

  test('сначала доход, затем содержание', () => {
    const s = blankState(map);
    own(s, 0, 0, 50);
    s.cells[0].pop = 10000;
    s.players[0].tax = 100;
    s.players[0].gold = 0;
    const log: TurnEvent[] = [];
    applyEconomy(s, map, log);
    // доход 10, содержание 5
    expect(s.players[0].gold).toBe(5);
    expect(s.cells[0].troops).toBe(50);
  });

  test('не хватает золота — каждая армия теряет 10%, золото не уходит в минус', () => {
    const s = blankState(map);
    own(s, 0, 0, 100);
    own(s, 6, 0, 40);
    s.cells[0].pop = 1000;
    s.players[0].tax = 0;
    s.players[0].gold = 3;
    const pre = previewEconomy(s, map, 0, 0);
    expect(pre.paid).toBe(false);
    const log: TurnEvent[] = [];
    applyEconomy(s, map, log);
    expect(s.players[0].gold).toBe(0);
    expect(s.cells[0].troops).toBe(90);
    expect(s.cells[6].troops).toBe(36);
    expect(log.some((e) => e.t === 'unpaid')).toBe(true);
  });

  test('рост населения +2% при счастье от 50%, −1% ниже 25%, потолок — двойное стартовое', () => {
    const s = blankState(map);
    own(s, 0, 0);
    own(s, 1, 0);
    own(s, 2, 0);
    s.cells[0].pop = 10000;
    s.cells[0].happiness = 60;
    s.cells[1].pop = 10000;
    s.cells[1].happiness = 20;
    s.cells[2].pop = 19900;
    s.cells[2].happiness = 90;
    applyGrowth(s, map);
    expect(s.cells[0].pop).toBe(10200);
    expect(s.cells[1].pop).toBe(9900);
    expect(s.cells[2].pop).toBe(20000);
  });

  test('счастье за ход сдвигается на 5 пунктов к цели', () => {
    const s = blankState(map);
    own(s, 0, 0);
    s.cells[0].happiness = 70;
    s.players[0].tax = 200; // цель 20
    applyGrowth(s, map);
    expect(s.cells[0].happiness).toBe(65);
    s.players[0].tax = 0; // цель 100
    applyGrowth(s, map);
    expect(s.cells[0].happiness).toBe(70);
    s.cells[0].happiness = 58;
    s.players[0].tax = 100; // цель 60, ближе 5 пунктов — встаёт ровно на цель
    applyGrowth(s, map);
    expect(s.cells[0].happiness).toBe(60);
  });

  test('налог из приказов действует уже в этом ходу', () => {
    const s = blankState(map);
    own(s, 0, 0, 0);
    own(s, 5, 1, 0);
    s.cells[0].pop = 10000;
    s.players[0].tax = 0;
    s.players[0].gold = 0;
    const next = resolveTurn(s, ordersFor(s, { 0: { tax: 200 } }));
    expect(next.players[0].tax).toBe(200);
    expect(next.players[0].gold).toBe(20);
  });
});
