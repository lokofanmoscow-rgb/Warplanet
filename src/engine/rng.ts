// Генератор с сидом партии (mulberry32). Math.random в движке не используется,
// поэтому любой ход воспроизводится по состоянию.

export class Rng {
  state: number;

  constructor(state: number) {
    this.state = state >>> 0;
  }

  /** Число в [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Число в [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Целое в [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  shuffle<T>(items: T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
