import { CONFIG } from './config';
import type { Action, ActionType, CellId, GameState, MapDef, PlayerId, TurnEvent } from './types';

const A = CONFIG.actions;

export const ACTION_AP: Record<ActionType, number> = {
  recruit: A.recruit.ap,
  fortify: A.fortify.ap,
  buy: A.buy.ap,
  loot: A.loot.ap,
};

export function ownedLandCount(state: GameState, map: MapDef, playerId: PlayerId): number {
  let n = 0;
  state.cells.forEach((c, id) => {
    if (c.owner === playerId && map.cells[id].kind === 'land') n++;
  });
  return n;
}

/** ОД за ход: 5 + 1 за каждые 10 своих провинций. */
export function actionPoints(state: GameState, map: MapDef, playerId: PlayerId): number {
  return CONFIG.ap.base + Math.floor(ownedLandCount(state, map, playerId) / CONFIG.ap.perProvinces);
}

/** Не больше 10% населения за раз: солдат × 100 жителей ≤ 10% населения. */
export function maxRecruit(pop: number): number {
  return Math.floor((pop * A.recruit.maxPopShare) / A.recruit.popPerSoldier);
}

export function buyCost(pop: number): number {
  return Math.ceil(pop / A.buy.popPerGold);
}

export function lootGold(pop: number): number {
  return Math.floor(pop / A.loot.popPerGold);
}

export function actionGold(state: GameState, action: Action): number {
  switch (action.type) {
    case 'recruit':
      return action.count * A.recruit.goldPerSoldier;
    case 'fortify':
      return A.fortify.gold;
    case 'buy':
      return buyCost(state.cells[action.cell].pop);
    case 'loot':
      return 0;
  }
}

/** Счётчик ресурсов игрока на время выполнения действий одного хода. */
export interface ActionBudget {
  ap: number;
  /** Сколько действий уже выполнено (для лимита лёгкого ИИ). */
  count: number;
  /** Ключи «тип:провинция» — одно действие каждого типа на провинцию за ход. */
  used: Set<string>;
}

export function newBudget(state: GameState, map: MapDef, playerId: PlayerId): ActionBudget {
  return { ap: actionPoints(state, map, playerId), count: 0, used: new Set() };
}

export function actionKey(action: Action): string {
  return `${action.type}:${action.cell}`;
}

/** Почему действие сейчас невозможно; null — можно. */
export function actionError(
  state: GameState,
  map: MapDef,
  playerId: PlayerId,
  action: Action,
  budget: ActionBudget,
): string | null {
  const def = map.cells[action.cell];
  const cell = state.cells[action.cell];
  const player = state.players[playerId];
  if (!def || !cell || !player) return 'Нет такой провинции';
  if (def.kind !== 'land') return 'Только на суше';
  if (budget.used.has(actionKey(action))) return 'Уже есть такое действие в этой провинции';
  if (budget.ap < ACTION_AP[action.type]) return 'Не хватает очков действия';
  const gold = actionGold(state, action);
  if (player.gold < gold) return 'Не хватает золота';

  switch (action.type) {
    case 'recruit': {
      if (cell.owner !== playerId) return 'Нанимать можно только в своей провинции';
      if (!Number.isInteger(action.count) || action.count < 1) return 'Неверное число солдат';
      if (action.count > maxRecruit(cell.pop)) return 'Не больше 10% населения за раз';
      return null;
    }
    case 'fortify': {
      if (cell.owner !== playerId) return 'Укреплять можно только свою провинцию';
      if (cell.fortified) return 'Провинция уже укреплена';
      return null;
    }
    case 'buy': {
      if (cell.owner !== null) return 'Купить можно только нейтральную провинцию';
      const adjacent = def.neighbors.some(
        (n) => map.cells[n].kind === 'land' && state.cells[n].owner === playerId,
      );
      if (!adjacent) return 'Провинция должна граничить с вашей';
      return null;
    }
    case 'loot': {
      if (cell.owner !== playerId) return 'Грабить можно только свою провинцию';
      return null;
    }
  }
}

/** Выполняет действие, если оно возможно. Возвращает текст ошибки или null. */
export function applyAction(
  state: GameState,
  map: MapDef,
  playerId: PlayerId,
  action: Action,
  budget: ActionBudget,
  log?: TurnEvent[],
): string | null {
  const error = actionError(state, map, playerId, action, budget);
  if (error) return error;
  const cell = state.cells[action.cell];
  const player = state.players[playerId];
  const gold = actionGold(state, action);
  player.gold -= gold;
  budget.ap -= ACTION_AP[action.type];
  budget.count++;
  budget.used.add(actionKey(action));

  switch (action.type) {
    case 'recruit':
      cell.troops += action.count;
      cell.pop -= action.count * A.recruit.popPerSoldier;
      log?.push({ t: 'recruit', player: playerId, cell: action.cell, count: action.count });
      break;
    case 'fortify':
      cell.fortified = true;
      log?.push({ t: 'fortify', player: playerId, cell: action.cell });
      break;
    case 'buy':
      cell.owner = playerId;
      if (!CONFIG.neutral.buyKeepsMilitia) cell.troops = 0;
      log?.push({ t: 'buy', player: playerId, cell: action.cell, cost: gold });
      break;
    case 'loot': {
      const gain = lootGold(cell.pop);
      player.gold += gain;
      cell.pop = Math.round(cell.pop * (1 - A.loot.popLoss));
      cell.happiness = Math.max(0, cell.happiness - A.loot.happinessLoss);
      log?.push({ t: 'loot', player: playerId, cell: action.cell, gold: gain });
      break;
    }
  }
  return null;
}

/** Клетки, где у игрока есть армия. */
export function armyCells(state: GameState, playerId: PlayerId): CellId[] {
  const out: CellId[] = [];
  state.cells.forEach((c, id) => {
    if (c.owner === playerId && c.troops > 0) out.push(id);
  });
  return out;
}
