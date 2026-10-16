import type { Difficulty } from './config';

export type PlayerId = number;
export type CellId = number;

// ---------- Карта (статичные данные, не меняются в партии) ----------

export type CellKind = 'land' | 'sea';

export interface MapCell {
  id: CellId;
  name: string;
  kind: CellKind;
  neighbors: CellId[];
  /** Стартовое население (у моря 0). */
  pop: number;
  /** Точка для иконок и подписи, в координатах карты. */
  center: [number, number];
  /** Контуры: каждый — плоский массив [x0, y0, x1, y1, ...]. */
  rings: number[][];
  /** Суша у моря. */
  coastal?: boolean;
  /** Код страны из исходных данных (для подсказок и раскраски). */
  country?: string;
}

export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  cells: MapCell[];
  /** Стартовые точки — id провинций-столиц. */
  startPoints: CellId[];
  /** Переходы через проливы, уже учтены в neighbors. */
  straits?: [CellId, CellId][];
}

// ---------- Состояние партии ----------

export type PlayerKind = 'human' | 'ai';

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  kind: PlayerKind;
  difficulty: Difficulty;
  gold: number;
  /** Налог в процентах, 0–200. */
  tax: number;
  alive: boolean;
  capital: CellId | null;
  eliminatedTurn?: number;
}

export interface CellState {
  /** Суша: владелец провинции (null — нейтрал). Море: чья армия стоит в зоне. */
  owner: PlayerId | null;
  /** Гарнизон владельца, ополчение нейтрала или армия в море. */
  troops: number;
  pop: number;
  /** Счастье в процентах. */
  happiness: number;
  fortified: boolean;
}

export type VictoryType = 'superiority' | 'domination' | 'annihilation' | 'flag';

export interface GameSettings {
  mapId: string;
  victory: VictoryType;
  /** Порог превосходства, % провинций суши. */
  superiority: number;
  /** Захват флага: сколько ходов подряд держать. */
  flagTurns: number;
  /** Отмеченная провинция для захвата флага. */
  flagCell: CellId | null;
  /** Лимит ходов, 0 — без лимита. */
  turnLimit: number;
}

export interface GameState {
  version: 1;
  id: string;
  mapId: string;
  seed: number;
  /** Текущее состояние генератора случайных чисел. */
  rng: number;
  /** Номер хода, который сейчас планируется. */
  turn: number;
  players: PlayerState[];
  cells: CellState[];
  settings: GameSettings;
  flag: { holder: PlayerId | null; turns: number };
  /** События последнего рассчитанного хода. */
  log: TurnEvent[];
  /** Число провинций у каждого игрока после каждого хода. */
  history: number[][];
  finished: boolean;
  winner: PlayerId | null;
  endReason?: EndReason;
}

export type EndReason =
  | 'superiority'
  | 'domination'
  | 'annihilation'
  | 'flag'
  | 'turnLimit'
  | 'humansOut';

// ---------- Приказы ----------

export type Action =
  | { type: 'recruit'; cell: CellId; count: number }
  | { type: 'fortify'; cell: CellId }
  | { type: 'buy'; cell: CellId }
  | { type: 'loot'; cell: CellId };

export type ActionType = Action['type'];

export interface Move {
  from: CellId;
  to: CellId;
  count: number;
}

export interface PlayerOrders {
  tax: number;
  actions: Action[];
  moves: Move[];
}

export type OrdersByPlayer = Record<PlayerId, PlayerOrders>;

// ---------- Журнал хода ----------

export type TurnEvent =
  | { t: 'income'; player: PlayerId; income: number; upkeep: number; gold: number }
  | { t: 'unpaid'; player: PlayerId; lost: number }
  | { t: 'recruit'; player: PlayerId; cell: CellId; count: number }
  | { t: 'fortify'; player: PlayerId; cell: CellId }
  | { t: 'buy'; player: PlayerId; cell: CellId; cost: number }
  | { t: 'loot'; player: PlayerId; cell: CellId; gold: number }
  | {
      t: 'battle';
      cell: CellId;
      /** Для боя на границе — откуда шёл атакующий. */
      from?: CellId;
      border?: boolean;
      attacker: PlayerId;
      defender: PlayerId | null;
      attack: number;
      defense: number;
      attackPower: number;
      defensePower: number;
      winner: PlayerId | null;
      attackerLeft: number;
      defenderLeft: number;
    }
  | { t: 'capture'; cell: CellId; player: PlayerId; from: PlayerId | null }
  | { t: 'capitalLost'; cell: CellId; player: PlayerId }
  | { t: 'eliminated'; player: PlayerId }
  | { t: 'victory'; player: PlayerId | null; reason: EndReason };
