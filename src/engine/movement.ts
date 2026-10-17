import { fight, type Fighter } from './battle';
import { CONFIG } from './config';
import type { Rng } from './rng';
import type { CellId, GameState, MapDef, Move, MoveKind, PlayerId, TurnEvent } from './types';
import { atWar } from './war';

const M = CONFIG.move;

export interface Reach {
  kind: MoveKind;
  /** Путь от исходной клетки до цели включительно. */
  path: CellId[];
}

/** Мирные перемещения выполняются сразу (и видны на карте ещё до «Готово»), остальные — бои. */
export function isPeaceful(kind: MoveKind): boolean {
  return kind !== 'attack' && kind !== 'naval';
}

function fleetOwner(state: GameState, id: CellId): PlayerId | null {
  const c = state.cells[id];
  return c.troops > 0 ? c.owner : null;
}

/**
 * Куда может пойти армия игрока из клетки from по текущему состоянию.
 * Суша: по своей земле до landRange шагов; последним шагом — в чужую сушу (нейтральную или страны,
 * с которой идёт война) или в море (посадка на корабли).
 * Флот: по свободному или своему морю до seaRange шагов; последним шагом — высадка или бой с вражеским флотом.
 */
export function reachable(state: GameState, map: MapDef, playerId: PlayerId, from: CellId): Map<CellId, Reach> {
  const out = new Map<CellId, Reach>();
  const start = map.cells[from];
  if (!start || state.cells[from].owner !== playerId) return out;
  const hostile = (owner: PlayerId | null) => owner !== null && owner !== playerId && atWar(state, playerId, owner);
  const sea = start.kind === 'sea';
  const range = sea ? M.seaRange : M.landRange;
  const prev = new Map<CellId, CellId>();
  const dist = new Map<CellId, number>([[from, 0]]);
  const pathTo = (end: CellId, last: CellId): CellId[] => {
    const p = [end];
    for (let c: CellId | undefined = last; c !== undefined; c = prev.get(c)) p.push(c);
    return p.reverse();
  };

  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    const d = dist.get(u)!;
    if (d >= range) continue;
    for (const n of map.cells[u].neighbors) {
      if (dist.has(n) || out.has(n)) continue;
      const land = map.cells[n].kind === 'land';
      const owner = land ? state.cells[n].owner : fleetOwner(state, n);
      let kind: MoveKind | null = null;
      if (owner !== null && owner !== playerId && !hostile(owner)) continue;
      if (!sea) {
        if (land) kind = owner === playerId ? 'march' : 'attack';
        else kind = owner === null || owner === playerId ? 'embark' : 'naval';
      } else if (land) {
        kind = owner === playerId ? 'land' : 'attack';
      } else {
        kind = owner === null || owner === playerId ? 'sail' : 'naval';
      }
      out.set(n, { kind, path: pathTo(n, u) });
      // Дальше идём только по своей земле или по свободному морю.
      if (kind === 'march' || kind === 'sail') {
        dist.set(n, d + 1);
        prev.set(n, u);
        queue.push(n);
      }
    }
  }
  return out;
}

/** Понятная причина, почему армия не может туда пойти. */
export function moveBlockReason(state: GameState, map: MapDef, playerId: PlayerId, from: CellId, to: CellId): string {
  const a = map.cells[from];
  const b = map.cells[to];
  if (!a || !b) return 'Нет такой клетки';
  if (from === to) return 'Армия уже здесь';
  const owner = b.kind === 'land' ? state.cells[to].owner : fleetOwner(state, to);
  if (owner !== null && owner !== playerId && !atWar(state, playerId, owner)) {
    return `Сначала объявите войну: нажмите на провинцию страны «${state.players[owner].name}»`;
  }
  if (a.kind === 'land') {
    if (b.kind === 'sea') return 'На корабли можно сесть только в море у вашего берега';
    if (owner !== playerId) return 'В чужую провинцию — только в соседнюю с вашей землёй, дальше по одной за ход';
    return `По своей земле — не дальше ${M.landRange} клеток`;
  }
  if (b.kind === 'sea') return `Флот проходит не больше ${M.seaRange} морских клеток, вражеский флот не обойти`;
  return 'Высадиться можно только на берег у пути флота';
}

/** Посадка на корабли стоит золото за каждого солдата. */
export function moveGold(map: MapDef, move: Move): number {
  return map.cells[move.from]?.kind === 'land' && map.cells[move.to]?.kind === 'sea' ? move.count * M.embarkGoldPerSoldier : 0;
}

/** Ошибка приказа для доступных солдат; null — можно. */
export function moveError(
  state: GameState,
  map: MapDef,
  playerId: PlayerId,
  move: Move,
  available: number,
): string | null {
  if (!map.cells[move.from] || !map.cells[move.to]) return 'Нет такой клетки';
  if (state.cells[move.from].owner !== playerId) return 'Здесь нет вашей армии';
  if (!Number.isInteger(move.count) || move.count < 1) return 'Неверное число солдат';
  if (move.count > available) return 'Недостаточно солдат';
  if (!reachable(state, map, playerId, move.from).has(move.to)) return moveBlockReason(state, map, playerId, move.from, move.to);
  return null;
}

function leave(state: GameState, map: MapDef, id: CellId, count: number): void {
  const cell = state.cells[id];
  cell.troops -= count;
  if (map.cells[id].kind === 'sea' && cell.troops <= 0) {
    cell.troops = 0;
    cell.owner = null;
  }
}

/**
 * Проверяет и выполняет один приказ: тратит ОД и золото на посадку, армия выходит из клетки;
 * мирное перемещение сразу приходит на место. Возвращает путь или ошибку.
 */
export function stepMove(
  state: GameState,
  map: MapDef,
  playerId: PlayerId,
  move: Move,
  available: number,
  budget: { ap: number },
): { error: string; reach?: undefined } | { error: null; reach: Reach } {
  const error = moveError(state, map, playerId, move, available);
  if (error) return { error };
  if (budget.ap < M.ap - 1e-9) return { error: 'Не хватает очков действия' };
  const player = state.players[playerId];
  const gold = moveGold(map, move);
  if (player.gold < gold) return { error: 'Не хватает золота на корабли' };
  const reach = reachable(state, map, playerId, move.from).get(move.to)!;
  budget.ap -= M.ap;
  player.gold -= gold;
  leave(state, map, move.from, move.count);
  if (isPeaceful(reach.kind)) {
    const cell = state.cells[move.to];
    cell.troops += move.count;
    if (map.cells[move.to].kind === 'sea') cell.owner = playerId;
  }
  return { error: null, reach };
}

interface Flow {
  player: PlayerId;
  /** Последняя клетка перед целью — отсюда армия входит в бой. */
  stage: CellId;
  to: CellId;
  count: number;
}

interface Group {
  player: PlayerId;
  troops: number;
  from: CellId[];
}

function strengthAt(map: MapDef, cell: CellId): number {
  return map.cells[cell].kind === 'sea' ? CONFIG.battle.seaStrength : 1;
}

/**
 * Шаги 4–5: перемещения и бои.
 * Игроки по очереди (случайной) выполняют приказы: мирные перемещения — сразу, армии для атаки выходят.
 * Затем бои на границах (встречные атаки), затем в каждой клетке бьются атакующие от слабейшего
 * к сильнейшему, выживший атакует защитника. apLeft — ОД игроков после действий.
 */
export function resolveMovement(
  state: GameState,
  map: MapDef,
  movesByPlayer: Map<PlayerId, Move[]>,
  rng: Rng,
  log: TurnEvent[],
  apLeft: Map<PlayerId, number> = new Map(),
): void {
  // 1. Приказы. Несколько атак через одну границу — один поток.
  const start = state.cells.map((c) => ({ owner: c.owner, troops: c.troops }));
  const flows = new Map<string, Flow>();
  const ids = rng.shuffle([...movesByPlayer.keys()].sort((a, b) => a - b));
  for (const player of ids) {
    const left = new Map<CellId, number>();
    const budget = { ap: apLeft.get(player) ?? Infinity };
    for (const move of movesByPlayer.get(player) ?? []) {
      if (!state.cells[move.from] || !map.cells[move.to]) continue;
      const available = left.get(move.from) ?? (start[move.from].owner === player ? start[move.from].troops : 0);
      const count = Math.min(Math.floor(move.count), available);
      const r = stepMove(state, map, player, { ...move, count }, available, budget);
      if (r.error !== null) continue;
      left.set(move.from, available - count);
      if (isPeaceful(r.reach.kind)) continue;
      const stage = r.reach.path[r.reach.path.length - 2];
      const key = `${player}:${stage}>${move.to}`;
      const flow = flows.get(key);
      if (flow) flow.count += count;
      else flows.set(key, { player, stage, to: move.to, count });
    }
  }

  // 2. Встречные атаки через одну границу — бой на границе, победитель идёт дальше.
  const list = [...flows.values()].sort((a, b) => a.stage - b.stage || a.to - b.to || a.player - b.player);
  for (const f of list) {
    if (f.count <= 0 || f.stage > f.to) continue;
    const g = list.find((x) => x.stage === f.to && x.to === f.stage && x.player !== f.player && x.count > 0);
    if (!g) continue;
    const both = map.cells[f.stage].kind === 'sea' && map.cells[f.to].kind === 'sea';
    const strength = both ? CONFIG.battle.seaStrength : 1;
    const r = fight(rng, { troops: f.count, strength, fort: 1 }, { troops: g.count, strength, fort: 1 }, false);
    log.push({
      t: 'battle',
      cell: f.to,
      from: f.stage,
      border: true,
      fromCells: [f.stage],
      defFromCells: [g.stage],
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

  // 3. Прибытие: суммируем армии каждого игрока по клеткам назначения.
  const arrivals = new Map<CellId, Map<PlayerId, Group>>();
  for (const f of list) {
    if (f.count <= 0) continue;
    let byPlayer = arrivals.get(f.to);
    if (!byPlayer) arrivals.set(f.to, (byPlayer = new Map()));
    const g = byPlayer.get(f.player);
    if (g) {
      g.troops += f.count;
      if (!g.from.includes(f.stage)) g.from.push(f.stage);
    } else byPlayer.set(f.player, { player: f.player, troops: f.count, from: [f.stage] });
  }

  // 4. Бои в клетках.
  const targets = [...arrivals.keys()].sort((a, b) => a - b);
  for (const target of targets) {
    resolveCell(state, map, target, arrivals.get(target)!, rng, log);
  }
}

function resolveCell(
  state: GameState,
  map: MapDef,
  target: CellId,
  byPlayer: Map<PlayerId, Group>,
  rng: Rng,
  log: TurnEvent[],
): void {
  const cell = state.cells[target];
  const sea = map.cells[target].kind === 'sea';
  const strength = strengthAt(map, target);

  // Свои армии, пришедшие в свою клетку, усиливают гарнизон.
  if (cell.owner !== null && byPlayer.has(cell.owner)) {
    cell.troops += byPlayer.get(cell.owner)!.troops;
    byPlayer.delete(cell.owner);
  }
  const attackers: Group[] = [...byPlayer.values()]
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
      fromCells: next.from,
      defFromCells: survivor.from,
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
    else if (r.winner === 'b') survivor = { ...next, troops: r.bLeft };
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
      fromCells: survivor.from,
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
