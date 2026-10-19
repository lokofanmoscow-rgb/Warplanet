import { CONFIG, type Difficulty } from './config';
import { militiaFor } from './economy';
import { distancesFrom } from './map';
import { Rng } from './rng';
import type { AiCharacter, CellId, CellState, GameSettings, GameState, MapDef, PlayerId, PlayerKind, PlayerState, VictoryType } from './types';

export interface PlayerSetup {
  name: string;
  kind: PlayerKind;
  difficulty?: Difficulty;
  /** Выбранная стартовая точка (у живых игроков), иначе случайная. */
  start?: CellId | null;
  color?: string;
}

export interface NewGameOptions {
  map: MapDef;
  players: PlayerSetup[];
  seed: number;
  id?: string;
  victory?: VictoryType;
  superiority?: number;
  flagTurns?: number;
  flagCell?: CellId | null;
  turnLimit?: number;
}

export function defaultSettings(mapId: string): GameSettings {
  return {
    mapId,
    victory: 'superiority',
    superiority: CONFIG.victory.superiorityDefault,
    flagTurns: CONFIG.victory.flagTurnsDefault,
    flagCell: null,
    turnLimit: 0,
  };
}

/** Провинция для захвата флага: суша ближе всего к центру, не стартовая точка. */
export function pickFlagCell(map: MapDef): CellId {
  const land = map.cells.filter((c) => c.kind === 'land');
  const cx = land.reduce((s, c) => s + c.center[0], 0) / land.length;
  const cy = land.reduce((s, c) => s + c.center[1], 0) / land.length;
  let best = land[0].id;
  let bestD = Infinity;
  for (const c of land) {
    if (map.startPoints.includes(c.id)) continue;
    const d = (c.center[0] - cx) ** 2 + (c.center[1] - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c.id;
    }
  }
  return best;
}

export function createGame(opts: NewGameOptions): GameState {
  const { map } = opts;
  if (opts.players.length < 2) throw new Error('Нужно минимум два игрока');
  if (opts.players.length > CONFIG.players.max) throw new Error('Слишком много игроков');
  if (opts.players.length > map.startPoints.length) throw new Error('На карте мало стартовых точек');
  const rng = new Rng(opts.seed);

  // Живые игроки выбирают точку в лобби, ИИ получают случайные из оставшихся.
  const taken = new Set<CellId>();
  for (const p of opts.players) {
    if (p.start != null) {
      if (!map.startPoints.includes(p.start) || taken.has(p.start)) throw new Error('Стартовая точка занята');
      taken.add(p.start);
    }
  }
  const free = rng.shuffle(map.startPoints.filter((s) => !taken.has(s)));
  const starts = opts.players.map((p) => (p.start != null ? p.start : free.pop()!));

  const cells: CellState[] = map.cells.map((c) => ({
    owner: null as number | null,
    troops: c.kind === 'land' ? militiaFor(c.pop) : 0,
    cav: 0,
    art: 0,
    pop: c.pop,
    happiness: CONFIG.start.happiness,
    fortified: false,
    dev: 0,
  }));

  const players: PlayerState[] = opts.players.map((p, id) => ({
    id,
    name: p.name,
    color: p.color ?? CONFIG.players.colors[id % CONFIG.players.colors.length],
    kind: p.kind,
    difficulty: p.difficulty ?? 'medium',
    gold: CONFIG.start.gold,
    tax: CONFIG.start.tax,
    alive: true,
    capital: starts[id],
    ...(p.kind === 'ai' ? { character: characterFor(opts.seed, id) } : {}),
  }));

  // Столица и две соседние провинции, армия 30 в столице.
  starts.forEach((capital, id) => {
    cells[capital].owner = id;
    cells[capital].troops = CONFIG.start.army;
  });
  starts.forEach((capital, id) => {
    const dist = distancesFrom(map, [capital], (n) => map.cells[n].kind === 'land');
    const candidates = map.cells
      .filter((c) => c.kind === 'land' && cells[c.id].owner === null && dist[c.id] < Infinity && dist[c.id] > 0)
      .sort((a, b) => dist[a.id] - dist[b.id] || b.pop - a.pop)
      .slice(0, CONFIG.start.extraProvinces);
    for (const c of candidates) {
      cells[c.id].owner = id;
      cells[c.id].troops = 0;
    }
  });

  const settings: GameSettings = {
    ...defaultSettings(map.id),
    victory: opts.victory ?? 'superiority',
    superiority: clampSuperiority(opts.superiority ?? CONFIG.victory.superiorityDefault),
    flagTurns: Math.max(1, Math.round(opts.flagTurns ?? CONFIG.victory.flagTurnsDefault)),
    turnLimit: Math.max(0, Math.round(opts.turnLimit ?? 0)),
  };
  if (settings.victory === 'flag') {
    const flag = opts.flagCell ?? pickFlagCell(map);
    settings.flagCell = cells[flag].owner === null ? flag : pickFlagCell(map);
  }

  return {
    version: 1,
    id: opts.id ?? `g${opts.seed.toString(36)}`,
    mapId: map.id,
    seed: opts.seed,
    rng: rng.state,
    turn: 1,
    players,
    cells,
    settings,
    flag: { holder: null, turns: 0 },
    log: [],
    history: [players.map((p) => cells.filter((c, i) => c.owner === p.id && map.cells[i].kind === 'land').length)],
    stats: {
      army: [players.map((p) => cells.reduce((sum, c) => sum + (c.owner === p.id ? c.troops : 0), 0))],
      gold: [players.map((p) => p.gold)],
      income: [players.map(() => 0)],
    },
    wars: [],
    warSince: {},
    peaceOffers: [],
    truces: [],
    finished: false,
    winner: null,
  };
}

/**
 * Характер ИИ — по сиду партии и номеру игрока, без расхода генератора случайных чисел
 * (иначе сдвинулись бы все случайности партии).
 */
export function characterFor(seed: number, id: PlayerId): AiCharacter {
  const h = Math.imul((seed ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0, 0x85ebca6b) >>> 0;
  return AI_CHARACTERS[(h >>> 13) % AI_CHARACTERS.length];
}

export const AI_CHARACTERS: AiCharacter[] = ['aggressive', 'trader', 'defender'];

export function clampSuperiority(v: number): number {
  return Math.min(CONFIG.victory.superiorityMax, Math.max(CONFIG.victory.superiorityMin, Math.round(v)));
}
