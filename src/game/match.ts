import { CONFIG, createGame, getMap, type Difficulty, type GameState, type VictoryType } from '../engine';
import { planAllAI } from '../ai/planOrders';
import { resolveTurn } from '../engine';
import type { OrdersByPlayer } from '../engine';
import '../maps';

export interface MatchSetup {
  mapId: string;
  victory: VictoryType;
  superiority: number;
  flagTurns: number;
  turnLimit: number;
  aiCount: number;
  aiDifficulty: Difficulty;
  humans: { name: string; start: number | null }[];
  seed?: number;
}

export function defaultSetup(mapId: string): Omit<MatchSetup, 'humans'> {
  return {
    mapId,
    victory: 'superiority',
    superiority: CONFIG.victory.superiorityDefault,
    flagTurns: CONFIG.victory.flagTurnsDefault,
    turnLimit: 0,
    aiCount: 4,
    aiDifficulty: 'medium',
  };
}

export function newSeed(): number {
  // Сид партии берётся снаружи движка; дальше вся случайность — из него.
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

/** Новая партия: сначала живые игроки, затем ИИ; ИИ называются по стране своей столицы. */
export function newMatch(setup: MatchSetup): GameState {
  const map = getMap(setup.mapId);
  const aiCount = Math.max(0, Math.min(CONFIG.players.maxAI, setup.aiCount));
  const total = Math.min(map.startPoints.length, setup.humans.length + aiCount);
  const seed = setup.seed ?? newSeed();
  const state = createGame({
    map,
    seed,
    victory: setup.victory,
    superiority: setup.superiority,
    flagTurns: setup.flagTurns,
    turnLimit: setup.turnLimit,
    players: [
      ...setup.humans.map((h) => ({ name: h.name, kind: 'human' as const, start: h.start })),
      ...Array.from({ length: total - setup.humans.length }, (_, i) => ({
        name: `ИИ ${i + 1}`,
        kind: 'ai' as const,
        difficulty: setup.aiDifficulty,
      })),
    ],
  });
  for (const p of state.players) {
    if (p.kind !== 'ai' || p.capital === null) continue;
    const cell = map.cells[p.capital];
    p.name = (cell.country && map.countries?.[cell.country]) || cell.name;
  }
  return state;
}

/** Ход на хосте: приказы ИИ по состоянию на начало хода, затем расчёт. */
export function runTurn(state: GameState, humanOrders: OrdersByPlayer): GameState {
  const ai = planAllAI(state);
  return resolveTurn(state, { ...humanOrders, ...ai });
}
