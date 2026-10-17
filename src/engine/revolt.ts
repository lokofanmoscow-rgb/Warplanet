import { fight } from './battle';
import { CONFIG } from './config';
import type { Rng } from './rng';
import type { GameState, MapDef, TurnEvent } from './types';

const R = CONFIG.revolt;

/** Шанс восстания за ход при таком счастье (0 — не бывает). */
export function revoltChance(happiness: number): number {
  return happiness >= R.below ? 0 : Math.min(1, (R.below - happiness) * R.chancePerPoint);
}

export function rebelsFor(pop: number): number {
  return Math.max(1, Math.round(pop / R.popPerRebel));
}

/**
 * Восстания в несчастных провинциях. Повстанцы бьются с гарнизоном (укрепление помогает защите).
 * Гарнизон выстоял — восстание подавлено, потери как в обычном бою. Нет — провинция становится
 * ничейной, на ней остаётся армия повстанцев: её может захватить любой, кто её победит.
 */
export function applyRevolts(state: GameState, map: MapDef, rng: Rng, log: TurnEvent[]): void {
  state.cells.forEach((cell, id) => {
    if (cell.owner === null || map.cells[id].kind !== 'land') return;
    const chance = revoltChance(cell.happiness);
    if (chance <= 0 || rng.next() >= chance) return;
    const player = cell.owner;
    const rebels = rebelsFor(cell.pop);
    const garrison = cell.troops;
    let left = rebels;
    if (garrison > 0) {
      const fort = cell.fortified ? CONFIG.actions.fortify.defenseMult : 1;
      const r = fight(rng, { troops: rebels, strength: 1, fort: 1 }, { troops: garrison, strength: fort, fort }, true);
      if (r.winner !== 'a') {
        cell.troops = r.bLeft;
        log.push({ t: 'revolt', cell: id, player, rebels, garrison, suppressed: true, left: r.bLeft });
        return;
      }
      left = r.aLeft;
    }
    cell.owner = null;
    cell.troops = Math.max(1, left);
    cell.fortified = false;
    log.push({ t: 'revolt', cell: id, player, rebels, garrison, suppressed: false, left: cell.troops });
    if (state.players[player].capital === id) {
      state.players[player].capital = null;
      log.push({ t: 'capitalLost', cell: id, player });
    }
  });
}
