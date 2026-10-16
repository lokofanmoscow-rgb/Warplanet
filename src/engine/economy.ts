import { CONFIG } from './config';
import type { CellState, GameState, MapDef, PlayerId, PlayerState, TurnEvent } from './types';

const E = CONFIG.economy;

export function clampTax(tax: number): number {
  if (!Number.isFinite(tax)) return CONFIG.start.tax;
  const stepped = Math.round(tax / E.taxStep) * E.taxStep;
  return Math.min(E.taxMax, Math.max(E.taxMin, stepped));
}

/** Цель счастья при налоге: 100 − 0,4 × налог. */
export function happinessTarget(tax: number): number {
  return E.happinessBase - E.happinessPerTax * tax;
}

/** Множитель дохода от счастья. */
export function incomeFactor(happiness: number): number {
  if (happiness >= E.fullAt) return 1;
  if (happiness >= E.partialAt) return E.partialK;
  return 0;
}

export function cellIncome(cell: CellState, tax: number): number {
  return (cell.pop / E.popPerGold) * (tax / 100) * incomeFactor(cell.happiness);
}

export function incomeMultiplier(player: PlayerState): number {
  return player.kind === 'ai' ? CONFIG.ai.difficulties[player.difficulty].incomeMult : 1;
}

export function playerIncome(state: GameState, map: MapDef, playerId: PlayerId, tax: number): number {
  let sum = 0;
  state.cells.forEach((cell, id) => {
    if (cell.owner === playerId && map.cells[id].kind === 'land') sum += cellIncome(cell, tax);
  });
  return Math.floor(sum * incomeMultiplier(state.players[playerId]));
}

export function playerUpkeep(state: GameState, map: MapDef, playerId: PlayerId): number {
  let units = 0;
  state.cells.forEach((cell, id) => {
    if (cell.owner !== playerId || cell.troops <= 0) return;
    units += cell.troops * (map.cells[id].kind === 'sea' ? E.seaUpkeepMult : 1);
  });
  return Math.floor(units / E.soldiersPerGold);
}

export interface EconomyPreview {
  income: number;
  upkeep: number;
  /** Хватает ли золота на содержание. */
  paid: boolean;
  /** Золото после дохода и содержания — с ним выполняются действия. */
  gold: number;
}

export function previewEconomy(state: GameState, map: MapDef, playerId: PlayerId, tax: number): EconomyPreview {
  const player = state.players[playerId];
  const income = playerIncome(state, map, playerId, tax);
  const upkeep = playerUpkeep(state, map, playerId);
  const total = player.gold + income;
  return total >= upkeep
    ? { income, upkeep, paid: true, gold: total - upkeep }
    : { income, upkeep, paid: false, gold: 0 };
}

export function unpaidLoss(troops: number): number {
  return Math.ceil(troops * E.unpaidLoss);
}

/** Шаг 2: доход по налогам, затем содержание армии. Налог уже выставлен игроку. */
export function applyEconomy(state: GameState, map: MapDef, log: TurnEvent[]): void {
  for (const player of state.players) {
    if (!player.alive) continue;
    const eco = previewEconomy(state, map, player.id, player.tax);
    player.gold = eco.gold;
    log.push({ t: 'income', player: player.id, income: eco.income, upkeep: eco.upkeep, gold: eco.gold });
    if (!eco.paid) {
      let lost = 0;
      for (const cell of state.cells) {
        if (cell.owner !== player.id || cell.troops <= 0) continue;
        const loss = unpaidLoss(cell.troops);
        cell.troops -= loss;
        lost += loss;
      }
      log.push({ t: 'unpaid', player: player.id, lost });
    }
  }
}

/** Шаг 6: рост населения, затем изменение счастья. Нейтралы восстанавливают ополчение. */
export function applyGrowth(state: GameState, map: MapDef): void {
  state.cells.forEach((cell, id) => {
    const def = map.cells[id];
    if (def.kind !== 'land') return;
    if (cell.owner === null) {
      const target = militiaFor(cell.pop);
      if (cell.troops < target) {
        cell.troops = Math.min(target, cell.troops + Math.max(1, Math.ceil(target * CONFIG.neutral.militiaRegen)));
      }
      return;
    }
    const cap = def.pop * E.popCapMult;
    if (cell.happiness >= E.growthAt) {
      cell.pop = Math.min(cap, Math.round(cell.pop * (1 + E.growth)));
    } else if (cell.happiness < E.declineBelow) {
      cell.pop = Math.round(cell.pop * (1 - E.decline));
    }
    const target = happinessTarget(state.players[cell.owner].tax);
    cell.happiness = stepToward(cell.happiness, target, E.happinessStep);
  });
}

export function stepToward(value: number, target: number, step: number): number {
  if (Math.abs(target - value) <= step) return target;
  return value + Math.sign(target - value) * step;
}

export function militiaFor(pop: number): number {
  return Math.round(pop / CONFIG.neutral.militiaPer);
}
