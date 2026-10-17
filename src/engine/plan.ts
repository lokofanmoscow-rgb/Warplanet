import { applyAction, newBudget } from './actions';
import { clampTax, previewEconomy, unpaidLoss, type EconomyPreview } from './economy';
import { getMap } from './map';
import { stepMove, type Reach } from './movement';
import { cloneState } from './turn';
import type { Action, GameState, Move, PlayerId, PlayerOrders } from './types';
import { declareWar } from './war';

export interface PlanResult {
  /**
   * Состояние после экономики, объявлений войны, действий и перемещений игрока:
   * мирные перемещения уже на месте, армии для атаки вышли из своих клеток.
   */
  projected: GameState;
  economy: EconomyPreview;
  apTotal: number;
  apLeft: number;
  /** Золото, оставшееся после действий и посадки на корабли. */
  goldLeft: number;
  actionErrors: (string | null)[];
  moveErrors: (string | null)[];
  warErrors: (string | null)[];
  /** Путь и вид каждого приказа на перемещение; null — приказ невозможен. */
  moveReach: (Reach | null)[];
  /** Солдат, которых ещё можно отправить из клетки (пришедшие в этом ходу больше не ходят). */
  available: number[];
}

/**
 * Прогноз приказов одного игрока в фазе планирования: те же правила и тот же порядок, что при расчёте
 * хода (экономика → войны → действия → перемещения), но без чужих приказов.
 */
export function simulatePlan(state: GameState, playerId: PlayerId, orders: PlayerOrders): PlanResult {
  const map = getMap(state.mapId);
  const projected = cloneState(state);
  const player = projected.players[playerId];
  player.tax = clampTax(orders.tax);
  const economy = previewEconomy(state, map, playerId, player.tax);
  player.gold = economy.gold;
  if (!economy.paid) {
    for (const cell of projected.cells) {
      if (cell.owner === playerId && cell.troops > 0) cell.troops -= unpaidLoss(cell.troops);
    }
  }

  const declared = new Set<PlayerId>();
  const warErrors = (orders.wars ?? []).map((target) => {
    if (declared.has(target)) return 'Война уже объявлена';
    declared.add(target);
    return declareWar(projected, map, playerId, target, state);
  });

  const budget = newBudget(state, map, playerId);
  const apTotal = budget.ap;
  const actionErrors = orders.actions.map((a) => applyAction(projected, map, playerId, a, budget));

  const available = projected.cells.map((c) => (c.owner === playerId ? c.troops : 0));
  const moveReach: (Reach | null)[] = [];
  const moveErrors = orders.moves.map((m) => {
    const r = stepMove(projected, map, playerId, m, available[m.from] ?? 0, budget);
    moveReach.push(r.reach ?? null);
    if (r.error === null) available[m.from] -= m.count;
    return r.error;
  });

  return {
    projected,
    economy,
    apTotal,
    apLeft: budget.ap,
    goldLeft: player.gold,
    actionErrors,
    moveErrors,
    warErrors,
    moveReach,
    available,
  };
}

/** Хост проверяет приказы клиента по правилам и отбрасывает невозможные. */
export function sanitizeOrders(state: GameState, playerId: PlayerId, raw: unknown): PlayerOrders {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<PlayerOrders>;
  const player = state.players[playerId];
  const orders: PlayerOrders = {
    tax: clampTax(typeof input.tax === 'number' ? input.tax : player?.tax ?? 0),
    actions: Array.isArray(input.actions) ? input.actions.filter(isAction) : [],
    moves: Array.isArray(input.moves) ? input.moves.filter(isMove) : [],
    wars: Array.isArray(input.wars) ? input.wars.filter(isInt) : [],
  };
  const plan = simulatePlan(state, playerId, orders);
  return {
    tax: orders.tax,
    actions: orders.actions.filter((_, i) => plan.actionErrors[i] === null),
    moves: orders.moves.filter((_, i) => plan.moveErrors[i] === null),
    wars: orders.wars!.filter((_, i) => plan.warErrors[i] === null),
  };
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isAction(a: unknown): a is Action {
  if (!a || typeof a !== 'object') return false;
  const x = a as Record<string, unknown>;
  if (!isInt(x.cell)) return false;
  if (x.type === 'recruit') return isInt(x.count);
  return x.type === 'fortify' || x.type === 'buy' || x.type === 'loot' || x.type === 'festival';
}

function isMove(m: unknown): m is Move {
  if (!m || typeof m !== 'object') return false;
  const x = m as Record<string, unknown>;
  return isInt(x.from) && isInt(x.to) && isInt(x.count);
}
