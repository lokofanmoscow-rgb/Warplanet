import { CONFIG } from './config';
import type { GameState, MapDef, PlayerId, TurnEvent } from './types';

function pair(a: PlayerId, b: PlayerId): [PlayerId, PlayerId] {
  return a < b ? [a, b] : [b, a];
}

export function atWar(state: GameState, a: PlayerId, b: PlayerId): boolean {
  if (a === b) return false;
  const [x, y] = pair(a, b);
  return (state.wars ?? []).some(([p, q]) => p === x && q === y);
}

/** Почему нельзя объявить войну; null — можно. */
export function warError(state: GameState, playerId: PlayerId, target: PlayerId): string | null {
  const t = state.players[target];
  if (!t || target === playerId) return 'Нет такой страны';
  if (!t.alive) return 'Эта страна уже выбыла';
  if (atWar(state, playerId, target)) return 'Война уже идёт';
  return null;
}

/**
 * Объявление войны: пара игроков воюет до конца партии. Объявивший теряет счастье во всех своих
 * провинциях, тот, на кого напали, — нет. Проверка — по состоянию на начало хода (before),
 * поэтому если оба объявили друг другу в одном ходу, счастье теряют оба.
 */
export function declareWar(
  state: GameState,
  map: MapDef,
  playerId: PlayerId,
  target: PlayerId,
  before: GameState,
  log?: TurnEvent[],
): string | null {
  const err = warError(before, playerId, target);
  if (err) return err;
  if (!atWar(state, playerId, target)) state.wars = [...(state.wars ?? []), pair(playerId, target)];
  state.cells.forEach((c, id) => {
    if (c.owner === playerId && map.cells[id].kind === 'land') {
      c.happiness = Math.max(0, c.happiness - CONFIG.war.happinessLoss);
    }
  });
  log?.push({ t: 'war', player: playerId, target });
  return null;
}
