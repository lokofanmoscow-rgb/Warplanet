import { CONFIG } from '../config';
import { createGame } from '../setup';
import type { GameState, MapDef } from '../types';
import { MAPS } from '../../maps';

function divided(map: MapDef, players: number, seed = 3, extra: Partial<Parameters<typeof createGame>[0]> = {}): GameState {
  return createGame({
    map,
    seed,
    startMode: 'divided',
    players: Array.from({ length: players }, (_, i) => ({ name: `ИИ ${i + 1}`, kind: 'ai' as const })),
    ...extra,
  });
}

const landOf = (s: GameState, map: MapDef, id: number) => s.cells.filter((c, i) => c.owner === id && map.cells[i].kind === 'land').length;

describe.each(MAPS.map((m) => [m.id, m] as const))('карта %s поделена между игроками', (_, map) => {
  const land = map.cells.filter((c) => c.kind === 'land').length;

  test.each([2, 3, 5, 8].filter((n) => n <= map.startPoints.length))('%i игроков: ничейной суши нет, провинций поровну', (n) => {
    const s = divided(map, n);
    expect(s.settings.startMode).toBe('divided');
    expect(map.cells.filter((c) => c.kind === 'land' && s.cells[c.id].owner === null)).toEqual([]);
    const counts = s.players.map((p) => landOf(s, map, p.id));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(land);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
    for (const p of s.players) {
      expect(s.cells[p.capital!].owner).toBe(p.id);
      expect(s.cells[p.capital!].troops).toBe(CONFIG.start.army);
    }
    // Гарнизоны во всех провинциях, кроме столиц, — не меньше минимума.
    for (const c of map.cells) {
      if (c.kind !== 'land' || s.players.some((p) => p.capital === c.id)) continue;
      expect(s.cells[c.id].troops).toBeGreaterThanOrEqual(CONFIG.start.dividedGarrisonMin);
    }
    // Порог превосходства выше начальной доли — победы на первом ходу не будет.
    expect(s.settings.superiority).toBeGreaterThan((Math.max(...counts) / land) * 100);
  });
});

describe('поделённая карта', () => {
  const map = MAPS.find((m) => m.id === 'europe')!;

  test('одинаковый сид — одинаковый раздел', () => {
    expect(divided(map, 4, 11).cells).toEqual(divided(map, 4, 11).cells);
  });

  test('выбранная столица остаётся за игроком, остальные — подальше от неё', () => {
    const start = map.startPoints[3];
    const s = createGame({
      map,
      seed: 5,
      startMode: 'divided',
      players: [{ name: 'Игрок', kind: 'human', start }, ...Array.from({ length: 3 }, (_, i) => ({ name: `ИИ ${i}`, kind: 'ai' as const }))],
    });
    expect(s.players[0].capital).toBe(start);
    expect(map.cells[start].neighbors).not.toContain(s.players[1].capital);
  });

  test('на захват флага ничейной остаётся только клетка с флагом', () => {
    const s = divided(map, 4, 2, { victory: 'flag' });
    const neutral = map.cells.filter((c) => c.kind === 'land' && s.cells[c.id].owner === null).map((c) => c.id);
    expect(neutral).toEqual([s.settings.flagCell]);
  });

  test('обычное начало не изменилось: столица и две провинции, остальное ничейное', () => {
    const s = createGame({ map, seed: 3, players: [{ name: 'А', kind: 'ai' }, { name: 'Б', kind: 'ai' }] });
    expect(s.settings.startMode).toBe('classic');
    expect(s.players.map((p) => landOf(s, map, p.id))).toEqual([1 + CONFIG.start.extraProvinces, 1 + CONFIG.start.extraProvinces]);
  });
});
