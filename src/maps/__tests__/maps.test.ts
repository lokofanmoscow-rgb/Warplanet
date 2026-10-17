import { distancesFrom } from '../../engine';
import { MAPS } from '..';

describe.each(MAPS.map((m) => [m.id, m] as const))('карта %s', (_, map) => {
  test('id клеток совпадают с индексами', () => {
    map.cells.forEach((c, i) => expect(c.id).toBe(i));
  });

  test('соседство симметрично и без петель', () => {
    for (const c of map.cells) {
      expect(c.neighbors).not.toContain(c.id);
      for (const n of c.neighbors) expect(map.cells[n].neighbors).toContain(c.id);
    }
  });

  test('все клетки достижимы', () => {
    const dist = distancesFrom(map, [map.startPoints[0]]);
    const unreachable = map.cells.filter((c) => dist[c.id] === Infinity).map((c) => c.name);
    expect(unreachable).toEqual([]);
  });

  test('провинции и морские зоны по ТЗ', () => {
    const land = map.cells.filter((c) => c.kind === 'land');
    const sea = map.cells.filter((c) => c.kind === 'sea');
    // Европа — около 90 провинций; Африка и США — по клетке на страну или штат (40–50).
    expect(land.length).toBeGreaterThanOrEqual(40);
    expect(land.length).toBeLessThanOrEqual(100);
    expect(sea.length).toBeGreaterThanOrEqual(15);
    for (const c of land) {
      expect(c.pop).toBeGreaterThanOrEqual(5000);
      expect(c.pop).toBeLessThanOrEqual(50000);
    }
    expect(new Set(map.cells.map((c) => c.name)).size).toBe(map.cells.length);
  });

  test('стартовые точки — суша, около 12, не граничат друг с другом', () => {
    expect(map.startPoints.length).toBeGreaterThanOrEqual(8);
    for (const s of map.startPoints) {
      expect(map.cells[s].kind).toBe('land');
      for (const o of map.startPoints) if (o !== s) expect(map.cells[s].neighbors).not.toContain(o);
    }
  });

  test('у каждой клетки есть контур и точка для иконок', () => {
    for (const c of map.cells) {
      expect(c.rings.length).toBeGreaterThan(0);
      expect(c.center[0]).toBeGreaterThanOrEqual(0);
      expect(c.center[0]).toBeLessThanOrEqual(map.width);
      expect(c.center[1]).toBeGreaterThanOrEqual(0);
      expect(c.center[1]).toBeLessThanOrEqual(map.height);
    }
  });
});
