import React, { createContext, useContext } from 'react';
import type { GameState } from '../engine';
import type { MatchController, Mode } from '../game/controller';

export type Screen =
  | { name: 'menu' }
  | { name: 'setup'; mode: 'ai' | 'hotseat' }
  | { name: 'host' }
  | { name: 'find' }
  | { name: 'game'; controller: MatchController }
  | { name: 'results'; game: GameState; mode: Mode; viewer: number | null };

export interface Nav {
  screen: Screen;
  go: (screen: Screen) => void;
}

export const NavContext = createContext<Nav>({ screen: { name: 'menu' }, go: () => {} });

export function useNav(): Nav {
  return useContext(NavContext);
}

export function NavProvider({ value, children }: { value: Nav; children: React.ReactNode }) {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}
