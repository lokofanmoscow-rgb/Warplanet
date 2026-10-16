import { ownedLandCount } from './actions';
import type { EndReason, GameState, MapDef, PlayerId, TurnEvent } from './types';

/** Шаг 7а: игрок без провинций и армий выбывает. */
export function applyEliminations(state: GameState, log: TurnEvent[]): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    const hasAnything = state.cells.some((c) => c.owner === player.id);
    if (!hasAnything) {
      player.alive = false;
      player.capital = null;
      player.eliminatedTurn = state.turn;
      log.push({ t: 'eliminated', player: player.id });
    }
  }
}

function finish(state: GameState, winner: PlayerId | null, reason: EndReason, log: TurnEvent[]): void {
  state.finished = true;
  state.winner = winner;
  state.endReason = reason;
  log.push({ t: 'victory', player: winner, reason });
}

/** Лидер по числу провинций, при равенстве — по войскам, затем по номеру. */
export function leader(state: GameState, map: MapDef, among: PlayerId[]): PlayerId | null {
  let best: PlayerId | null = null;
  let bestKey: [number, number] = [-1, -1];
  for (const id of among) {
    const provinces = ownedLandCount(state, map, id);
    const troops = state.cells.reduce((s, c) => s + (c.owner === id ? c.troops : 0), 0);
    if (provinces > bestKey[0] || (provinces === bestKey[0] && troops > bestKey[1])) {
      best = id;
      bestKey = [provinces, troops];
    }
  }
  return best;
}

/** Шаг 7б: проверка условия победы в конце хода. state.turn — только что рассчитанный ход. */
export function checkVictory(state: GameState, map: MapDef, log: TurnEvent[]): void {
  const s = state.settings;
  const alive = state.players.filter((p) => p.alive).map((p) => p.id);
  const land = map.cells.filter((c) => c.kind === 'land').length;

  // Флаг считается каждый ход, чтобы счётчик был честным.
  if (s.flagCell !== null) {
    const owner = state.cells[s.flagCell].owner;
    if (owner !== null && owner === state.flag.holder) state.flag.turns++;
    else state.flag = { holder: owner, turns: owner === null ? 0 : 1 };
  }

  if (alive.length === 0) return finish(state, null, 'annihilation', log);
  if (alive.length === 1) return finish(state, alive[0], 'annihilation', log);

  const humans = state.players.filter((p) => p.kind === 'human');
  if (humans.length > 0 && humans.every((p) => !p.alive)) {
    return finish(state, leader(state, map, alive), 'humansOut', log);
  }

  for (const id of alive) {
    const share = (ownedLandCount(state, map, id) / land) * 100;
    if (s.victory === 'domination' && share >= 100) return finish(state, id, 'domination', log);
    if (s.victory === 'superiority' && share >= s.superiority) return finish(state, id, 'superiority', log);
  }

  if (s.victory === 'flag' && state.flag.holder !== null && state.flag.turns >= s.flagTurns) {
    return finish(state, state.flag.holder, 'flag', log);
  }

  if (s.turnLimit > 0 && state.turn >= s.turnLimit) {
    return finish(state, leader(state, map, alive), 'turnLimit', log);
  }
}
