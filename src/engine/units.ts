import { CONFIG } from './config';
import type { CellState, Move, UnitType } from './types';

const U = CONFIG.units;

export const UNIT_TYPES: UnitType[] = ['inf', 'cav', 'art'];

/** Состав армии: пехота, кавалерия, артиллерия. */
export interface Squad {
  inf: number;
  cav: number;
  art: number;
}

export const EMPTY_SQUAD: Squad = { inf: 0, cav: 0, art: 0 };

export function squadSize(s: Squad): number {
  return s.inf + s.cav + s.art;
}

/** Армия клетки. В старых сохранениях cav и art нет — вся армия пехота. */
export function squadOf(cell: CellState): Squad {
  const cav = Math.max(0, Math.min(cell.cav ?? 0, cell.troops));
  const art = Math.max(0, Math.min(cell.art ?? 0, cell.troops - cav));
  return { inf: Math.max(0, cell.troops - cav - art), cav, art };
}

export function setSquad(cell: CellState, s: Squad): void {
  cell.troops = squadSize(s);
  cell.cav = s.cav;
  cell.art = s.art;
}

export function addSquads(a: Squad, b: Squad): Squad {
  return { inf: a.inf + b.inf, cav: a.cav + b.cav, art: a.art + b.art };
}

export function subSquads(a: Squad, b: Squad): Squad {
  return { inf: Math.max(0, a.inf - b.inf), cav: Math.max(0, a.cav - b.cav), art: Math.max(0, a.art - b.art) };
}

/** Состав приказа: count всего, из них cav и art. */
export function moveSquad(move: Move): Squad {
  const cav = move.cav ?? 0;
  const art = move.art ?? 0;
  return { inf: move.count - cav - art, cav, art };
}

/** Хватает ли в available каждого типа войск. */
export function fits(want: Squad, available: Squad): boolean {
  return want.inf <= available.inf && want.cav <= available.cav && want.art <= available.art;
}

/** Не больше, чем есть, по каждому типу. */
export function clampSquad(want: Squad, available: Squad): Squad {
  return { inf: Math.min(want.inf, available.inf), cav: Math.min(want.cav, available.cav), art: Math.min(want.art, available.art) };
}

/** Потери в бою: первой гибнет пехота, затем кавалерия, последней — артиллерия за их спинами. */
export function takeLosses(s: Squad, lost: number): Squad {
  let n = Math.max(0, lost);
  const out = { ...s };
  for (const t of UNIT_TYPES) {
    const k = Math.min(out[t], n);
    out[t] -= k;
    n -= k;
  }
  return out;
}

/** Потери поровну по долям (армия разбегается без жалования). */
export function takeShare(s: Squad, lost: number): Squad {
  const size = squadSize(s);
  if (size <= 0) return { ...s };
  const n = Math.min(size, Math.max(0, lost));
  const out = { ...s };
  let left = n;
  for (const t of ['cav', 'art'] as const) {
    const k = Math.min(out[t], Math.round((n * s[t]) / size));
    out[t] -= k;
    left -= k;
  }
  return takeLosses(out, left);
}

/** Суммарная сила армии в атаке или обороне (пехота = 1). */
export function squadPower(s: Squad, role: 'attack' | 'defense'): number {
  return UNIT_TYPES.reduce((sum, t) => sum + s[t] * U[t][role], 0);
}

/** Средняя сила одного солдата — множитель для боя. */
export function perSoldier(s: Squad, role: 'attack' | 'defense'): number {
  const size = squadSize(s);
  return size > 0 ? squadPower(s, role) / size : 1;
}

/** Дальность по своей земле: смешанная армия идёт со скоростью самого медленного. */
export function rangeOf(s: Squad): number {
  const present = UNIT_TYPES.filter((t) => s[t] > 0);
  return present.length ? Math.min(...present.map((t) => U[t].range)) : U.inf.range;
}

/** Самая большая дальность среди войск клетки — куда дойдёт хоть кто-то. */
export function maxRangeOf(s: Squad): number {
  const present = UNIT_TYPES.filter((t) => s[t] > 0);
  return present.length ? Math.max(...present.map((t) => U[t].range)) : U.inf.range;
}

/** Содержание в «пехотных» единицах. */
export function upkeepUnits(s: Squad): number {
  return UNIT_TYPES.reduce((sum, t) => sum + s[t] * U[t].upkeep, 0);
}

/**
 * Множитель укрепления против этой армии: артиллерия снимает его — полностью,
 * если её не меньше siegeShare армии, иначе пропорционально.
 */
export function fortAgainst(fort: number, attacker: Squad): number {
  if (fort <= 1) return 1;
  const size = squadSize(attacker);
  const siege = size > 0 ? Math.min(1, attacker.art / (size * U.siegeShare)) : 0;
  return 1 + (fort - 1) * (1 - siege);
}
