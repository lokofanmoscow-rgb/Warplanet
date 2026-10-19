import { applyAction, newBudget } from './actions';
import { applyEconomy, applyGrowth, clampTax } from './economy';
import { getMap } from './map';
import { resolveMovement } from './movement';
import { applyRevolts } from './revolt';
import { Rng } from './rng';
import type { GameState, Move, OrdersByPlayer, PlayerId, PlayerOrders, TurnEvent } from './types';
import { applyEliminations, checkVictory } from './victory';
import { applyPeace, declareWar } from './war';

export function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p })),
    cells: s.cells.map((c) => ({ ...c })),
    settings: { ...s.settings },
    flag: { ...s.flag },
    log: s.log.slice(),
    history: s.history.map((h) => h.slice()),
    wars: s.wars?.slice(),
    warSince: s.warSince ? { ...s.warSince } : undefined,
    peaceOffers: s.peaceOffers?.slice(),
    truces: s.truces?.slice(),
    stats: s.stats ? { army: s.stats.army.slice(), gold: s.stats.gold.slice(), income: s.stats.income.slice() } : undefined,
  };
}

export function emptyOrders(state: GameState, playerId: PlayerId): PlayerOrders {
  return { tax: state.players[playerId]?.tax ?? 0, actions: [], moves: [], wars: [], peace: [] };
}

/** Армия, золото и доход каждого игрока на конец хода — для графиков итогов. */
export function statsRow(state: GameState, log: TurnEvent[]): { army: number[]; gold: number[]; income: number[] } {
  const income = state.players.map((p) => {
    const e = log.find((x) => x.t === 'income' && x.player === p.id);
    return e && e.t === 'income' ? e.income : 0;
  });
  return {
    army: state.players.map((p) => state.cells.reduce((sum, c) => sum + (c.owner === p.id ? c.troops : 0), 0)),
    gold: state.players.map((p) => p.gold),
    income,
  };
}

/**
 * Расчёт хода. orders — приказы всех игроков, включая ИИ (их считает хост до вызова).
 * Порядок: экономика → мир → объявления войны → действия → перемещения и бои → рост и счастье → восстания →
 * выбывание и победа.
 * Функция чистая: исходное состояние не меняется, случайность — только из генератора партии.
 */
export function resolveTurn(prev: GameState, orders: OrdersByPlayer): GameState {
  if (prev.finished) return prev;
  const map = getMap(prev.mapId);
  const state = cloneState(prev);
  const rng = new Rng(state.rng);
  const log: TurnEvent[] = [];
  const alive = state.players.filter((p) => p.alive);
  const ordersOf = (id: PlayerId): PlayerOrders => orders[id] ?? emptyOrders(prev, id);

  // 2. Экономика: доход этого хода — по налогу, который уже действует (выбран в прошлом ходу).
  applyEconomy(state, map, log);

  // Новый налог действует со следующего хода: в конце этого хода к нему тянется счастье,
  // а доход по нему — в следующем. Поднять налог и сразу получить золото нельзя.
  for (const p of alive) p.tax = clampTax(ordersOf(p.id).tax);

  // Мир: если обе стороны согласны — война кончается до действий и перемещений этого хода.
  applyPeace(state, prev, new Map(alive.map((p) => [p.id, ordersOf(p.id).peace ?? []])), log);

  // Объявления войны действуют уже в этом ходу: можно объявить и сразу атаковать.
  for (const p of alive) {
    for (const target of new Set(ordersOf(p.id).wars ?? [])) declareWar(state, map, p.id, target, prev, log);
  }

  // 3. Действия в провинциях. ОД считаются по состоянию на начало хода.
  // Очерёдность игроков случайная, чтобы спор за одну нейтральную провинцию решался честно.
  const budgets = new Map(alive.map((p) => [p.id, newBudget(prev, map, p.id)]));
  for (const p of rng.shuffle(alive)) {
    for (const action of ordersOf(p.id).actions ?? []) {
      applyAction(state, map, p.id, action, budgets.get(p.id)!, log);
    }
  }

  // 4–5. Перемещения (на оставшиеся ОД) и бои.
  const moves = new Map<PlayerId, Move[]>();
  for (const p of alive) moves.set(p.id, ordersOf(p.id).moves ?? []);
  const apLeft = new Map(alive.map((p) => [p.id, budgets.get(p.id)!.ap]));
  resolveMovement(state, map, moves, rng, log, apLeft);

  // 6. Рост населения и счастье, затем восстания в несчастных провинциях.
  applyGrowth(state, map);
  applyRevolts(state, map, rng, log);

  // 7. Выбывание и победа.
  applyEliminations(state, log);
  checkVictory(state, map, log);

  state.history.push(
    state.players.map((p) => state.cells.filter((c, i) => c.owner === p.id && map.cells[i].kind === 'land').length),
  );
  const row = statsRow(state, log);
  const stats = state.stats ?? { army: [], gold: [], income: [] };
  state.stats = { army: [...stats.army, row.army], gold: [...stats.gold, row.gold], income: [...stats.income, row.income] };
  state.log = log;
  state.rng = rng.state;
  if (!state.finished) state.turn++;
  return state;
}
