import { CONFIG } from './config';
import type { Rng } from './rng';

const B = CONFIG.battle;

export interface Fighter {
  troops: number;
  /** Множитель силы: укрепление ×2, море ×0,5. */
  strength: number;
  /** Множитель укрепления — делит потери, если этот боец победит. */
  fort: number;
}

export interface FightResult {
  /** 'a' — победил первый, 'b' — второй, 'none' — ничья без защитника, оба погибли. */
  winner: 'a' | 'b' | 'none';
  aPower: number;
  bPower: number;
  aLeft: number;
  bLeft: number;
}

/**
 * Бой: сила каждой стороны × случайный множитель 0,95–1,05.
 * Первый (атакующий) побеждает, только если его сила больше.
 * Ничья — в пользу защиты (bDefends), без защитника гибнут оба.
 * Проигравший теряет всю армию, победитель — силу проигравшего × 0,5 / укрепление, с округлением вверх.
 */
export function fight(rng: Rng, a: Fighter, b: Fighter, bDefends: boolean): FightResult {
  const aPower = a.troops * a.strength * rng.range(1 - B.randomSpread, 1 + B.randomSpread);
  const bPower = b.troops * b.strength * rng.range(1 - B.randomSpread, 1 + B.randomSpread);
  if (aPower > bPower) {
    return { winner: 'a', aPower, bPower, aLeft: Math.max(0, a.troops - losses(bPower, a.fort)), bLeft: 0 };
  }
  if (aPower < bPower || bDefends) {
    return { winner: 'b', aPower, bPower, aLeft: 0, bLeft: Math.max(0, b.troops - losses(aPower, b.fort)) };
  }
  return { winner: 'none', aPower, bPower, aLeft: 0, bLeft: 0 };
}

export function losses(loserPower: number, winnerFort: number): number {
  // Защита от погрешности плавающей точки: 20.000000001 не должно стать 21.
  return Math.ceil((loserPower * B.winnerLossShare) / winnerFort - 1e-9);
}
