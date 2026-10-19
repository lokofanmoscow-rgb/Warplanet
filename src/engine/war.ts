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

function pairKey(a: PlayerId, b: PlayerId): string {
  const [x, y] = pair(a, b);
  return `${x}-${y}`;
}

/** До какого хода действует перемирие пары (null — нет перемирия). */
export function truceUntil(state: GameState, a: PlayerId, b: PlayerId): number | null {
  const [x, y] = pair(a, b);
  const t = (state.truces ?? []).find((v) => v.a === x && v.b === y && v.until > state.turn);
  return t ? t.until : null;
}

/** Почему нельзя объявить войну; null — можно. */
export function warError(state: GameState, playerId: PlayerId, target: PlayerId): string | null {
  const t = state.players[target];
  if (!t || target === playerId) return 'Нет такой страны';
  if (!t.alive) return 'Эта страна уже выбыла';
  if (atWar(state, playerId, target)) return 'Война уже идёт';
  const truce = truceUntil(state, playerId, target);
  if (truce !== null) return `Перемирие до хода ${truce}`;
  return null;
}

/** Сколько ходов идёт война пары (0 — началась в этом ходу или в старом сохранении). */
export function warTurns(state: GameState, a: PlayerId, b: PlayerId): number {
  const since = state.warSince?.[pairKey(a, b)];
  return since === undefined ? 0 : Math.max(0, state.turn - since);
}

/**
 * Усталость от войны: насколько снижена цель счастья у игрока. Каждая война с живой страной —
 * wearyBase и ещё +1 за каждые wearyEvery ходов, не больше wearyPerWar; всего не больше wearyMax.
 */
export function warWeariness(state: GameState, playerId: PlayerId): number {
  const W = CONFIG.war;
  let sum = 0;
  for (const [a, b] of state.wars ?? []) {
    if (a !== playerId && b !== playerId) continue;
    const other = a === playerId ? b : a;
    if (!state.players[other]?.alive) continue;
    sum += Math.min(W.wearyPerWar, W.wearyBase + Math.floor(warTurns(state, a, b) / W.wearyEvery));
  }
  return Math.min(W.wearyMax, sum);
}

/** Почему нельзя предложить мир; null — можно. */
export function peaceError(state: GameState, playerId: PlayerId, target: PlayerId): string | null {
  const t = state.players[target];
  if (!t || target === playerId) return 'Нет такой страны';
  if (!t.alive) return 'Эта страна уже выбыла';
  if (!atWar(state, playerId, target)) return 'С этой страной нет войны';
  return null;
}

/** target предложил мир игроку в прошлом ходу — предложение ещё в силе. */
export function hasPeaceOffer(state: GameState, from: PlayerId, to: PlayerId): boolean {
  return (state.peaceOffers ?? []).some(([f, t]) => f === from && t === to);
}

/**
 * Мир заключается, если обе стороны его хотят: предложили друг другу в одном ходу или одна
 * принимает предложение другой из прошлого хода. После мира — перемирие на truceTurns ходов.
 * Непринятые предложения живут один ход. Проверка — по состоянию на начало хода (before).
 */
export function applyPeace(
  state: GameState,
  before: GameState,
  wants: Map<PlayerId, PlayerId[]>,
  log: TurnEvent[],
): void {
  const offers: [PlayerId, PlayerId][] = [];
  const done = new Set<string>();
  for (const [p, targets] of wants) {
    for (const target of new Set(targets)) {
      if (peaceError(before, p, target) !== null) continue;
      const key = pairKey(p, target);
      if (done.has(key)) continue;
      const mutual = (wants.get(target) ?? []).includes(p) || hasPeaceOffer(before, target, p);
      if (!mutual) {
        offers.push([p, target]);
        log.push({ t: 'peaceOffer', player: p, target });
        continue;
      }
      done.add(key);
      const [a, b] = pair(p, target);
      const until = before.turn + 1 + CONFIG.war.truceTurns;
      state.wars = (state.wars ?? []).filter(([x, y]) => !(x === a && y === b));
      if (state.warSince) {
        state.warSince = { ...state.warSince };
        delete state.warSince[key];
      }
      state.truces = [...(state.truces ?? []).filter((t) => t.until > before.turn && !(t.a === a && t.b === b)), { a, b, until }];
      log.push({ t: 'peace', a, b, until });
    }
  }
  state.peaceOffers = offers.filter(([p, t]) => !done.has(pairKey(p, t)));
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
  if (!atWar(state, playerId, target)) {
    state.wars = [...(state.wars ?? []), pair(playerId, target)];
    state.warSince = { ...(state.warSince ?? {}), [pairKey(playerId, target)]: before.turn };
  }
  state.cells.forEach((c, id) => {
    if (c.owner === playerId && map.cells[id].kind === 'land') {
      c.happiness = Math.max(0, c.happiness - CONFIG.war.happinessLoss);
    }
  });
  log?.push({ t: 'war', player: playerId, target });
  return null;
}
