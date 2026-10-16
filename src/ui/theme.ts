import { useWindowDimensions } from 'react-native';
import { CONFIG } from '../engine';

// Палитра из ТЗ: живая настольная карта, тёплая суша, глубокое море.
export const COLORS = {
  seaDeep: '#1F4E79',
  seaCoast: '#3A7CA5',
  neutral: '#D9C9A3',
  border: '#3B2F2F',
  gold: '#D4A437',
  panel: '#2B2118',
  text: '#F5EBD7',
  // Производные для интерфейса.
  panelLight: '#3A2E22',
  panelDeep: '#1E1711',
  goldDark: '#8E6A1F',
  goldLight: '#F0CF72',
  textDim: '#BFAF92',
  danger: '#E0604F',
  ok: '#7FC46A',
  background: '#8C8170',
  overlay: 'rgba(20, 14, 9, 0.72)',
  players: CONFIG.players.colors as readonly string[],
} as const;

export const FONTS = {
  title: 'PTSerif-Bold',
  serif: 'PTSerif-Regular',
  text: 'PTSans-Regular',
  bold: 'PTSans-Bold',
} as const;

export const FONT_FILES = {
  'PTSerif-Bold': require('../../assets/fonts/PTSerif-Bold.ttf'),
  'PTSerif-Regular': require('../../assets/fonts/PTSerif-Regular.ttf'),
  'PTSans-Regular': require('../../assets/fonts/PTSans-Regular.ttf'),
  'PTSans-Bold': require('../../assets/fonts/PTSans-Bold.ttf'),
};

export interface Layout {
  width: number;
  height: number;
  landscape: boolean;
  /** Планшет: короткая сторона от 600 dp. */
  tablet: boolean;
  /** Масштаб интерфейса: телефон 1, планшет крупнее. */
  s: number;
}

/** Размеры экрана и масштаб интерфейса — одинаково на телефоне и планшете. */
export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const short = Math.min(width, height);
  const tablet = short >= 600;
  const s = Math.max(0.85, Math.min(1.45, short / (tablet ? 560 : 400)));
  return { width, height, landscape: width > height, tablet, s };
}

export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** Осветление/затемнение цвета: k > 0 — светлее, k < 0 — темнее. */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const f = (c: number) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  r = f(r);
  g = f(g);
  b = f(b);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
