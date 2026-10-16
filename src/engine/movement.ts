import { fight, type Fighter } from './battle';
import { CONFIG } from './config';
import type { Rng } from './rng';
import type { CellId, GameState, MapDef, Move, PlayerId, TurnEvent } from './types';

interface Flow {
  player: PlayerId;
  from: CellId;
  to: CellId;
  count: number;
}

interface Group {
  player: PlayerId;
  troops: number;
}

/** Ошибка приказа на движение для текущих доступных солдат; null — можно. */
export function moveError(
  state: GameState,
  map: MapDef,
  playerId: PlayerId,
  move: Move,
  available: number,
): string | null {
  const from = map.cells[move.from];
  if (!from || !map.cells[move.to]) return 'Нет такой клетки';
  if (state.cells[move.from].owner !== playerId) return 'Здесь нет вашей армии';
  if (!from.neighbors.includes(move.to)) return 'Армия идёт только на соседнюю клетку';
  if (!Number.isInteger(move.count) || move.count < 1) return 'Неверное число солдат';
  if (move.count > available) return 'Недостаточно солдат';
  return null;
}

function strengthAt(map: MapDef, cell: CellId): number {
  return map.cells[cell].kind === 'sea' ? CONFIG.battle.seaStrength : 1;
}

/**
 * Шаги 4–5: движение армий на одну клетку и бои.
 * Сначала все армии выходят, затем бои на границах (встречное движение),
 * затем в каждой клетке бьются атакующие от слабейшего к сильнейшему, выживший атакует защитника.
 */
export function resolveMovement(
  state: GameState,
  map: MapDef,
  movesByPlayer: Map<PlayerId, Move[]>,
  rng: Rng,
  log: TurnEvent[],
): void {
  // 1. Проверка и сложение приказов. Несколько приказов по одной границе — один поток.
  const flows = new Map<string, Flow>();
  const ids = [...movesByPlayer.keys()].sort((a, b) => a - b);
  for (const player of ids) {
    const left = new Map<CellId, number>();
    for (const move of movesByPlayer.get(player) ?? []) {
      const cell = state.cells[move.from];
      if (!cell) continue;
      const available = left.get(move.from) ?? (cell.owner === player ? cell.troops : 0);
      const count = Math.min(Math.floor(move.count), available);
      if (moveError(state, map, player, { ...move, count }, available) !== null) continue;
      left.set(move.from, available - count);
      const key = `${player}:${move.from}>${move.to}`;
      const flow = flows.get(key);
      if (flow) flow.count += count;
      else flows.set(key, { player, from: move.from, to: move.to, count });
    }
  }

  // 2. Армии выходят из клеток.
  for (const flow of flows.values()) {
    const cell = state.cells[flow.from];
    cell.troops -= flow.count;
    if (map.cells[flow.from].kind === 'sea' && cell.troops <= 0) {
      cell.troops = 0;
      cell.owner = null;
    }
  }

  // 3. Встречное движение через одну границу — бой на границе, победитель идёт дальше.
  const list = [...flows.values()].sort((a, b) => a.from - b.from || a.to - b.to || a.player - b.player);
  for (const f of list) {
    if (f.count <= 0 || f.from > f.to) continue;
    const g = list.find((x) => x.from === f.to && x.to === f.from && x.player !== f.player && x.count > 0);
    if (!g) continue;
    const both = map.cells[f.from].kind === 'sea' && map.cells[f.to].kind === 'sea';
    const strength = both ? CONFIG.battle.seaStrength : 1;
    const r = fight(rng, { troops: f.count, strength, fort: 1 }, { troops: g.count, strength, fort: 1 }, false);
    log.push({
      t: 'battle',
      cell: f.to,
      from: f.from,
      border: true,
      attacker: f.player,
      defender: g.player,
      attack: f.count,
      defense: g.count,
      attackPower: r.aPower,
      defensePower: r.bPower,
      winner: r.winner === 'a' ? f.player : r.winner === 'b' ? g.player : null,
      attackerLeft: r.aLeft,
      defenderLeft: r.bLeft,
    });
    f.count = r.aLeft;
    g.count = r.bLeft;
  }

  // 4. Прибытие: суммируем армии каждого игрока по клеткам назначения.
  const arrivals = new Map<CellId, Map<PlayerId, number>>();
  for (const f of list) {
    if (f.count <= 0) continue;
    let byPlayer = arrivals.get(f.to);
    if (!byPlayer) arrivals.set(f.to, (byPlayer = new Map()));
    byPlayer.set(f.player, (byPlayer.get(f.player) ?? 0) + f.count);
  }

  // 5. Бои в клетках.
  const targets = [...arrivals.keys()].sort((a, b) => a - b);
  for (const target of targets) {
    resolveCell(state, map, target, arrivals.get(target)!, rng, log);
  }
}

function resolveCell(
  state: GameState,
  map: MapDef,
  target: CellId,
  byPlayer: Map<PlayerId, number>,
  rng: Rng,
  log: TurnEvent[],
): void {
  const cell = state.cells[target];
  const sea = map.cells[target].kind === 'sea';
  const strength = strengthAt(map, target);

  // Свои армии, пришедшие в свою клетку, усиливают гарнизон.
  if (cell.owner !== null && byPlayer.has(cell.owner)) {
    cell.troops += byPlayer.get(cell.owner)!;
    byPlayer.delete(cell.owner);
  }
  const attackers: Group[] = [...byPlayer.entries()]
    .map(([player, troops]) => ({ player, troops }))
    .filter((g) => g.troops > 0)
    .sort((a, b) => a.troops - b.troops || a.player - b.player);
  if (attackers.length === 0) return;

  // Атакующие бьются между собой от слабейшего к сильнейшему.
  let survivor: Group | null = null;
  for (const next of attackers) {
    if (!survivor) {
      survivor = { ...next };
      continue;
    }
    const r = fight(rng, { troops: survivor.troops, strength, fort: 1 }, { troops: next.troops, strength, fort: 1 }, false);
    log.push({
      t: 'battle',
      cell: target,
      attacker: next.player,
      defender: survivor.player,
      attack: next.troops,
      defense: survivor.troops,
      attackPower: r.bPower,
      defensePower: r.aPower,
      winner: r.winner === 'a' ? survivor.player : r.winner === 'b' ? next.player : null,
      attackerLeft: r.bLeft,
      defenderLeft: r.aLeft,
    });
    if (r.winner === 'a') survivor.troops = r.aLeft;
    else if (r.winner === 'b') survivor = { player: next.player, troops: r.bLeft };
    else survivor = null;
  }
  if (!survivor) return;

  const defender = cell.owner;
  if (cell.troops > 0) {
    const fort = !sea && cell.fortified ? CONFIG.actions.fortify.defenseMult : 1;
    const att: Fighter = { troops: survivor.troops, strength, fort: 1 };
    const def: Fighter = { troops: cell.troops, strength: strength * fort, fort };
    const r = fight(rng, att, def, true);
    log.push({
      t: 'battle',
      cell: target,
      attacker: survivor.player,
      defender,
      attack: survivor.troops,
      defense: cell.troops,
      attackPower: r.aPower,
      defensePower: r.bPower,
      winner: r.winner === 'a' ? survivor.player : defender,
      attackerLeft: r.aLeft,
      defenderLeft: r.bLeft,
    });
    if (r.winner !== 'a') {
      cell.troops = r.bLeft;
      if (sea && cell.troops <= 0) cell.owner = null;
      return;
    }
    survivor.troops = r.aLeft;
  }

  // Захват клетки.
  if (sea) {
    cell.owner = survivor.troops > 0 ? survivor.player : null;
    cell.troops = survivor.troops;
    return;
  }
  capture(state, target, survivor.player, survivor.troops, log);
}

export function capture(state: GameState, target: CellId, player: PlayerId, troops: number, log: TurnEvent[]): void {
  const cell = state.cells[target];
  const prev = cell.owner;
  const E = CONFIG.economy;
  cell.owner = player;
  cell.troops = troops;
  cell.fortified = false;
  cell.happiness = E.capturedHappiness;
  cell.pop = Math.round(cell.pop * (1 - E.capturedPopLoss));
  log.push({ t: 'capture', cell: target, player, from: prev });
  if (prev !== null && state.players[prev].capital === target) {
    state.players[prev].capital = null;
    log.push({ t: 'capitalLost', cell: target, player: prev });
  }
}
