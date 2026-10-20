import { CONFIG, type Difficulty } from './config';
import { militiaFor } from './economy';
import { distancesFrom } from './map';
import { Rng } from './rng';
import type {
  AiCharacter,
  CellId,
  CellState,
  GameSettings,
  GameState,
  MapDef,
  PlayerId,
  PlayerKind,
  PlayerState,
  StartMode,
  VictoryType,
} from './types';

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
  startMode?: StartMode;
}

export function defaultSettings(mapId: string): GameSettings {
  return {
    mapId,
    victory: 'superiority',
    superiority: CONFIG.victory.superiorityDefault,
    flagTurns: CONFIG.victory.flagTurnsDefault,
    flagCell: null,
    turnLimit: 0,
    startMode: 'classic',
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
  const divided = opts.startMode === 'divided';
  const free = rng.shuffle(map.startPoints.filter((s) => !taken.has(s)));
  // Поделённой карте нужны столицы подальше друг от друга, иначе кому-то достанется угол;
  // в обычной партии — случайные, но не впритык.
  const chosen = opts.players.map((p) => p.start ?? null);
  const starts = divided ? spreadStarts(map, chosen, free, rng) : scatterStarts(map, chosen, free);

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

  // Столица с армией 30.
  starts.forEach((capital, id) => {
    cells[capital].owner = id;
    cells[capital].troops = CONFIG.start.army;
  });

  const settings: GameSettings = {
    ...defaultSettings(map.id),
    victory: opts.victory ?? 'superiority',
    superiority: clampSuperiority(opts.superiority ?? CONFIG.victory.superiorityDefault),
    flagTurns: Math.max(1, Math.round(opts.flagTurns ?? CONFIG.victory.flagTurnsDefault)),
    turnLimit: Math.max(0, Math.round(opts.turnLimit ?? 0)),
    startMode: divided ? 'divided' : 'classic',
  };

  if (divided) {
    // Вся суша сразу у игроков, войска — в столице и ещё в части провинций. Ничейной остаётся
    // только клетка с флагом, если играют на захват флага.
    const flag = settings.victory === 'flag' ? (opts.flagCell != null && !starts.includes(opts.flagCell) ? opts.flagCell : pickFlagCell(map)) : null;
    divideLand(map, cells, starts, flag);
    placeGarrisons(map, cells, starts, rng);
    if (flag !== null) settings.flagCell = flag;
    // Порог превосходства — заметно выше начальной доли самого крупного игрока.
    const land = map.cells.filter((c) => c.kind === 'land').length;
    const biggest = Math.max(...starts.map((_, id) => cells.filter((c, i) => c.owner === id && map.cells[i].kind === 'land').length));
    const floor = Math.ceil((biggest / land) * 100) + CONFIG.start.dividedSuperiorityMargin;
    settings.superiority = clampSuperiority(Math.max(settings.superiority, floor));
  } else {
    // Ещё две соседние провинции без армии.
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
    if (settings.victory === 'flag') {
      const flag = opts.flagCell ?? pickFlagCell(map);
      settings.flagCell = cells[flag].owner === null ? flag : pickFlagCell(map);
    }
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
 * Столицы обычной партии: выбранные игроками остаются, остальным — случайные точки не ближе
 * startSpacing шагов к уже занятым (если таких нет — хотя бы не соседние).
 */
function scatterStarts(map: MapDef, chosen: (CellId | null)[], shuffled: CellId[]): CellId[] {
  const out = [...chosen];
  const pool = [...shuffled];
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== null) continue;
    const taken = out.filter((s): s is CellId => s !== null);
    const dist = taken.length ? distancesFrom(map, taken) : null;
    const k = [CONFIG.start.startSpacing, 2, 0].map((d) => pool.findIndex((c) => !dist || dist[c] >= d)).find((x) => x >= 0)!;
    out[i] = pool.splice(k, 1)[0];
  }
  return out as CellId[];
}

/**
 * Столицы для поделённой карты: выбранные игроками остаются, остальным — по очереди случайная
 * точка из самых далёких от уже занятых (не ближе 80% наибольшего расстояния).
 */
function spreadStarts(map: MapDef, chosen: (CellId | null)[], shuffled: CellId[], rng: Rng): CellId[] {
  const out = [...chosen];
  const pool = [...shuffled];
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== null) continue;
    const taken = out.filter((s): s is CellId => s !== null);
    if (!taken.length) {
      out[i] = pool.shift()!;
      continue;
    }
    const dist = distancesFrom(map, taken);
    const far = Math.max(...pool.map((c) => dist[c]));
    const good = pool.filter((c) => dist[c] >= Math.max(2, far * 0.8));
    const pick = good.length ? good[rng.int(good.length)] : pool[0];
    pool.splice(pool.indexOf(pick), 1);
    out[i] = pick;
  }
  return out as CellId[];
}

/**
 * Войска на поделённой карте: у каждого одинаковое число провинций с гарнизоном (около
 * dividedGarrisonCells от меньшего из владений, считая столицу с её армией), все гарнизоны
 * одного размера. Сначала — провинции на границе с соседями, среди них — случайные.
 */
function placeGarrisons(map: MapDef, cells: CellState[], starts: CellId[], rng: Rng) {
  const isLand = (i: CellId) => map.cells[i].kind === 'land';
  const own = starts.map((_, id) => map.cells.filter((c) => isLand(c.id) && cells[c.id].owner === id).map((c) => c.id));
  const k = Math.max(1, Math.round(Math.min(...own.map((o) => o.length)) * CONFIG.start.dividedGarrisonCells));
  own.forEach((list, id) => {
    const rest = rng.shuffle(list.filter((c) => c !== starts[id]));
    const border = (c: CellId) => map.cells[c].neighbors.some((n) => isLand(n) && cells[n].owner !== null && cells[n].owner !== id);
    const ordered = [...rest.filter(border), ...rest.filter((c) => !border(c))];
    for (const c of ordered.slice(0, k - 1)) cells[c].troops = CONFIG.start.dividedGarrison;
  });
}

/**
 * Делит всю сушу между игроками поровну по числу провинций. Клетка достаётся тому, чья столица
 * ближе (путь по центрам клеток, через море дороже), с поправкой на «вес» игрока; веса подбираются,
 * пока провинций у всех не станет поровну. У такой взвешенной диаграммы Вороного на графе каждая
 * клетка соединена со своей столицей кратчайшим путём через свои же клетки — владения цельные
 * (разорваны только морем).
 */
function divideLand(map: MapDef, cells: CellState[], starts: CellId[], reserved: CellId | null) {
  const land = map.cells.filter((c) => c.kind === 'land' && c.id !== reserved).map((c) => c.id);
  const length = (a: CellId, b: CellId) => {
    const [ax, ay] = map.cells[a].center;
    const [bx, by] = map.cells[b].center;
    const sea = map.cells[a].kind === 'sea' || map.cells[b].kind === 'sea';
    return Math.hypot(ax - bx, ay - by) * (sea ? SEA_COST : 1);
  };
  const dist = starts.map((s) => shortestPaths(map, s, length, reserved));
  let edges = 0;
  let edgeSum = 0;
  for (const a of land) for (const b of map.cells[a].neighbors) if (map.cells[b].kind === 'land') {
    edges++;
    edgeSum += length(a, b);
  }
  const unit = edges ? edgeSum / edges : 1;
  const capitalOf = new Map(starts.map((s, id) => [s, id]));
  const bias = starts.map(() => 0);
  const target = land.length / starts.length;
  const assign = (): PlayerId[] =>
    land.map((c) => {
      const cap = capitalOf.get(c);
      if (cap !== undefined) return cap;
      let best = 0;
      for (let p = 1; p < starts.length; p++) if (dist[p][c] + bias[p] < dist[best][c] + bias[best]) best = p;
      return best;
    });
  let best = assign();
  let bestSpread = Infinity;
  let step = unit;
  for (let it = 0; it < 600; it++) {
    const owners = assign();
    const count = starts.map(() => 0);
    for (const o of owners) count[o]++;
    const spread = Math.max(...count) - Math.min(...count);
    if (spread < bestSpread) {
      best = owners;
      bestSpread = spread;
    }
    if (spread <= 1) break;
    // Кому досталось больше — дальше «отодвигаем», кому меньше — приближаем.
    for (let p = 0; p < starts.length; p++) bias[p] += (step * (count[p] - target)) / target;
    step *= 0.992;
  }
  land.forEach((c, k) => {
    cells[c].owner = best[k];
    if (!capitalOf.has(c)) cells[c].troops = 0;
  });
  evenOut(map, cells, starts, (p, c) => dist[p][c] + bias[p]);
}

/**
 * Досчитывает остаток, если веса не уравняли провинции до ±1: клетка на границе переходит
 * от большего игрока к соседу, у которого на две и более провинции меньше, — если владения
 * отдающего от этого не распадаются на части. Берётся самая «спорная» клетка (cost ближе всего).
 */
function evenOut(map: MapDef, cells: CellState[], starts: CellId[], cost: (p: PlayerId, c: CellId) => number) {
  const isLand = (i: CellId) => map.cells[i].kind === 'land';
  const count = starts.map((_, id) => cells.filter((c, i) => c.owner === id && isLand(i)).length);
  const parts = (id: PlayerId): number => {
    const mine = map.cells.filter((c) => isLand(c.id) && cells[c.id].owner === id).map((c) => c.id);
    const seen = new Set<CellId>();
    let k = 0;
    for (const c of mine) {
      if (seen.has(c)) continue;
      k++;
      const stack = [c];
      seen.add(c);
      while (stack.length) {
        const x = stack.pop()!;
        for (const n of map.cells[x].neighbors) if (isLand(n) && cells[n].owner === id && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return k;
  };
  // Клетки, отдать которые нельзя (распались бы владения), больше не пробуем.
  const frozen = new Set<CellId>(starts);
  for (let guard = 0; guard < 500; guard++) {
    if (Math.max(...count) - Math.min(...count) <= 1) return;
    let move: { c: CellId; from: PlayerId; to: PlayerId; score: number } | null = null;
    for (const c of map.cells) {
      const from = cells[c.id].owner;
      if (!isLand(c.id) || from === null || frozen.has(c.id)) continue;
      for (const n of c.neighbors) {
        const to = cells[n].owner;
        if (!isLand(n) || to === null || to === from || count[to] > count[from] - 2) continue;
        const score = cost(to, c.id) - cost(from, c.id);
        if (!move || score < move.score) move = { c: c.id, from, to, score };
      }
    }
    if (!move) return;
    const before = parts(move.from);
    cells[move.c].owner = move.to;
    if (parts(move.from) > before) {
      cells[move.c].owner = move.from;
      frozen.add(move.c);
      continue;
    }
    count[move.from]--;
    count[move.to]++;
  }
}

/** Переход через море дороже, чем по суше: острова отходят соседям по берегу, а не через полмира. */
const SEA_COST = 1.4;

/** Дейкстра по центрам клеток от одной клетки (клетка skip непроходима). */
function shortestPaths(map: MapDef, from: CellId, length: (a: CellId, b: CellId) => number, skip: CellId | null): number[] {
  const dist = new Array<number>(map.cells.length).fill(Infinity);
  const done = new Array<boolean>(map.cells.length).fill(false);
  dist[from] = 0;
  for (;;) {
    let cur = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (cur < 0 || dist[i] < dist[cur])) cur = i;
    if (cur < 0) break;
    done[cur] = true;
    for (const n of map.cells[cur].neighbors) {
      if (n === skip) continue;
      const d = dist[cur] + length(cur, n);
      if (d < dist[n]) dist[n] = d;
    }
  }
  return dist;
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
