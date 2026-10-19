import { CONFIG } from './config';
import type { CellState, GameState, MapDef, PlayerId, PlayerState, TurnEvent } from './types';
import { setSquad, squadOf, takeShare, upkeepUnits } from './units';
import { atWar, warWeariness } from './war';

const E = CONFIG.economy;

export function clampTax(tax: number): number {
  if (!Number.isFinite(tax)) return CONFIG.start.tax;
  const stepped = Math.round(tax / E.taxStep) * E.taxStep;
  return Math.min(E.taxMax, Math.max(E.taxMin, stepped));
}

/** Цель счастья при налоге: чем выше налог, тем круче падает. */
export function happinessTarget(tax: number): number {
  return Math.max(0, E.happinessBase - E.happinessPerTax * tax - E.happinessPerTax2 * tax * tax);
}

/** Цель счастья игрока: по налогу, минус усталость от войны. */
export function targetHappiness(state: GameState, playerId: PlayerId, tax = state.players[playerId]?.tax ?? 0): number {
  return Math.max(0, happinessTarget(tax) - warWeariness(state, playerId));
}

/** Счастье за ход: растёт на шаг, падает быстрее — на долю разрыва до цели. */
export function nextHappiness(value: number, target: number): number {
  if (target >= value) return stepToward(value, target, E.happinessStep);
  return stepToward(value, target, Math.max(E.happinessStep, (value - target) * E.happinessFallShare));
}

/** Множитель дохода от счастья. */
export function incomeFactor(happiness: number): number {
  if (happiness >= E.fullAt) return 1;
  if (happiness >= E.partialAt) return E.partialK;
  return 0;
}

/** Доход провинции: население × налог × счастье × хозяйство. */
export function cellIncome(cell: CellState, tax: number): number {
  return (cell.pop / E.popPerGold) * (tax / 100) * incomeFactor(cell.happiness) * (1 + E.devIncome * (cell.dev ?? 0));
}

/**
 * Торговые партнёры: живые страны, с которыми мир и есть общая граница по суше
 * или берега у одного моря.
 */
export function tradePartners(state: GameState, map: MapDef, playerId: PlayerId): PlayerId[] {
  const found = new Set<PlayerId>();
  const add = (owner: PlayerId | null) => {
    if (owner !== null && owner !== playerId && state.players[owner]?.alive && !atWar(state, playerId, owner)) found.add(owner);
  };
  state.cells.forEach((cell, id) => {
    if (cell.owner !== playerId || map.cells[id].kind !== 'land') return;
    for (const n of map.cells[id].neighbors) {
      if (map.cells[n].kind === 'land') add(state.cells[n].owner);
      else for (const m of map.cells[n].neighbors) if (map.cells[m].kind === 'land') add(state.cells[m].owner);
    }
  });
  return [...found].sort((a, b) => a - b);
}

/** Прибавка к доходу от торговли с мирными соседями (доля). */
export function tradeBonus(state: GameState, map: MapDef, playerId: PlayerId): number {
  return Math.min(E.tradeMax, tradePartners(state, map, playerId).length * E.tradePerPartner);
}

export function incomeMultiplier(player: PlayerState): number {
  return player.kind === 'ai' ? CONFIG.ai.difficulties[player.difficulty].incomeMult : 1;
}

export function playerIncome(state: GameState, map: MapDef, playerId: PlayerId, tax: number): number {
  let sum = 0;
  state.cells.forEach((cell, id) => {
    if (cell.owner === playerId && map.cells[id].kind === 'land') sum += cellIncome(cell, tax);
  });
  return Math.floor(sum * (1 + tradeBonus(state, map, playerId)) * incomeMultiplier(state.players[playerId]));
}

/** Содержание армии: кавалерия и артиллерия дороже пехоты, в море — ×seaUpkeepMult. */
export function playerUpkeep(state: GameState, map: MapDef, playerId: PlayerId): number {
  let units = 0;
  state.cells.forEach((cell, id) => {
    if (cell.owner !== playerId || cell.troops <= 0) return;
    units += upkeepUnits(squadOf(cell)) * (map.cells[id].kind === 'sea' ? E.seaUpkeepMult : 1);
  });
  return Math.floor(units / E.soldiersPerGold);
}

/** Армия без жалования: каждая теряет долю солдат, поровну по типам войск. */
export function desert(cell: CellState): number {
  const loss = unpaidLoss(cell.troops);
  setSquad(cell, takeShare(squadOf(cell), loss));
  return loss;
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

/**
 * Доход следующего хода при налоге tax: счастье к тому времени сдвинется к цели этого налога.
 * Прирост населения не учитывается — это оценка для окна налога.
 */
export function forecastIncome(state: GameState, map: MapDef, playerId: PlayerId, tax: number): number {
  const target = targetHappiness(state, playerId, tax);
  let sum = 0;
  state.cells.forEach((cell, id) => {
    if (cell.owner !== playerId || map.cells[id].kind !== 'land') return;
    sum += cellIncome({ ...cell, happiness: Math.round(nextHappiness(cell.happiness, target)) }, tax);
  });
  return Math.floor(sum * (1 + tradeBonus(state, map, playerId)) * incomeMultiplier(state.players[playerId]));
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
        lost += desert(cell);
      }
      log.push({ t: 'unpaid', player: player.id, lost });
    }
  }
}

/** Шаг 6: рост населения, затем изменение счастья. Нейтралы восстанавливают ополчение. */
export function applyGrowth(state: GameState, map: MapDef): void {
  // Цель счастья у каждого игрока одна на все провинции: налог и усталость от войны.
  const targets = new Map(state.players.map((p) => [p.id, targetHappiness(state, p.id)]));
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
    cell.happiness = Math.round(nextHappiness(cell.happiness, targets.get(cell.owner)!));
  });
}

export function stepToward(value: number, target: number, step: number): number {
  if (Math.abs(target - value) <= step) return target;
  return value + Math.sign(target - value) * step;
}

export function militiaFor(pop: number): number {
  const N = CONFIG.neutral;
  return Math.min(N.militiaMax, Math.max(N.militiaMin, Math.round(pop / N.militiaPer)));
}
