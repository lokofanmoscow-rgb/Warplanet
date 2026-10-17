import { CONFIG } from './config';
import { distancesFrom } from './map';
import type { CellId, GameState, MapDef, PlayerId } from './types';

/**
 * Что видит игрок: клетки не дальше CONFIG.vision.range шагов (по суше и морю) от своих провинций
 * и своих армий, включая флот. Чьи земли — видно везде, а армии — только здесь.
 */
export function visibleCells(state: GameState, map: MapDef, playerId: PlayerId): Set<CellId> {
  const sources: CellId[] = [];
  state.cells.forEach((c, id) => {
    if (c.owner === playerId && (map.cells[id].kind === 'land' || c.troops > 0)) sources.push(id);
  });
  const dist = distancesFrom(map, sources);
  const out = new Set<CellId>();
  dist.forEach((d, id) => {
    if (d <= CONFIG.vision.range) out.add(id);
  });
  return out;
}
