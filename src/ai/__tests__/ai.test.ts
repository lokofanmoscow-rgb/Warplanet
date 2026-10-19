import { CONFIG, createGame, happinessTarget, ownedLandCount, resolveTurn, simulatePlan, type GameState } from '../../engine';
import { getMap, DEFAULT_MAP_ID } from '../../maps';
import { aiTax, planAllAI, planOrders } from '../planOrders';

function aiGame(count: number, seed: number, difficulty: 'easy' | 'medium' | 'hard' = 'medium', mapId = DEFAULT_MAP_ID): GameState {
  const map = getMap(mapId);
  return createGame({
    map,
    seed,
    players: Array.from({ length: count }, (_, i) => ({ name: `ИИ ${i + 1}`, kind: 'ai' as const, difficulty })),
  });
}

describe('ИИ-соперники', () => {
  test('налог — самый высокий, при котором счастье не ниже порога ИИ', () => {
    const t = aiTax();
    expect(happinessTarget(t)).toBeGreaterThanOrEqual(CONFIG.ai.minHappiness);
    expect(happinessTarget(t + 10)).toBeLessThan(CONFIG.ai.minHappiness);
  });

  test('приказы ИИ проходят проверку движка', () => {
    const s = aiGame(6, 11);
    for (const p of s.players) {
      const orders = planOrders(s, p.id, 'hard');
      const plan = simulatePlan(s, p.id, orders);
      expect(plan.actionErrors.every((e) => e === null)).toBe(true);
      expect(plan.moveErrors.every((e) => e === null)).toBe(true);
    }
  });

  test('лёгкий ИИ делает не больше двух действий за ход', () => {
    let s = aiGame(4, 5, 'easy');
    for (let turn = 0; turn < 15; turn++) {
      for (const p of s.players) {
        if (p.alive) expect(planOrders(s, p.id, 'easy').actions.length).toBeLessThanOrEqual(2);
      }
      s = resolveTurn(s, planAllAI(s));
    }
  });

  test('столица не остаётся без гарнизона', () => {
    const s = aiGame(6, 3);
    for (const p of s.players) {
      const orders = planOrders(s, p.id, 'medium');
      // В прогнозе ушедшие армии уже вышли из клетки.
      const plan = simulatePlan(s, p.id, orders);
      expect(plan.projected.cells[p.capital!].troops).toBeGreaterThanOrEqual(5);
    }
  });

  test('партия только из ИИ развивается и укладывается по времени', () => {
    let s = aiGame(7, 2024, 'hard');
    const map = getMap(s.mapId);
    let worst = 0;
    for (let turn = 0; turn < 120 && !s.finished; turn++) {
      const t0 = Date.now();
      const orders = planAllAI(s);
      worst = Math.max(worst, Date.now() - t0);
      s = resolveTurn(s, orders);
    }
    const owned = s.players.reduce((sum, p) => sum + ownedLandCount(s, map, p.id), 0);
    // Нейтральная суша разбирается, кто-то выбывает или побеждает.
    expect(owned).toBeGreaterThan(40);
    expect(s.finished || s.players.some((p) => !p.alive)).toBe(true);
    // 300 мс на среднем телефоне; на компьютере с запасом.
    expect(worst).toBeLessThan(300);
  });

  test.each(['africa', 'usa', 'russia', 'world'])('на карте %s ИИ тоже играет: приказы верны, земля разбирается', (mapId) => {
    let s = aiGame(6, 77, 'hard', mapId);
    const map = getMap(mapId);
    for (let turn = 0; turn < 60 && !s.finished; turn++) {
      if (turn % 10 === 0) {
        for (const p of s.players.filter((x) => x.alive)) {
          const plan = simulatePlan(s, p.id, planOrders(s, p.id, 'hard'));
          expect(plan.actionErrors.every((e) => e === null)).toBe(true);
          expect(plan.moveErrors.every((e) => e === null)).toBe(true);
        }
      }
      s = resolveTurn(s, planAllAI(s));
    }
    const owned = s.players.reduce((sum, p) => sum + ownedLandCount(s, map, p.id), 0);
    expect(owned).toBeGreaterThan(20);
  });

  test('сильный ИИ обычно обыгрывает лёгких', () => {
    let wins = 0;
    for (const seed of [1, 2, 3]) {
      const map = getMap(DEFAULT_MAP_ID);
      let s = createGame({
        map,
        seed,
        victory: 'superiority',
        superiority: 50,
        players: [
          { name: 'Сильный', kind: 'ai', difficulty: 'hard' },
          { name: 'Лёгкий 1', kind: 'ai', difficulty: 'easy' },
          { name: 'Лёгкий 2', kind: 'ai', difficulty: 'easy' },
          { name: 'Лёгкий 3', kind: 'ai', difficulty: 'easy' },
        ],
      });
      for (let turn = 0; turn < 200 && !s.finished; turn++) s = resolveTurn(s, planAllAI(s));
      const leader = [...s.players].sort((a, b) => ownedLandCount(s, map, b.id) - ownedLandCount(s, map, a.id))[0];
      if (leader.id === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(2);
  });
});
