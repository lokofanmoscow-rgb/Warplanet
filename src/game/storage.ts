import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMap, type GameState } from '../engine';
import '../maps';

// Сохранение и продолжение партии. Хост сохраняет состояние после каждого хода.

export type SavedMode = 'ai' | 'hotseat' | 'host';

export interface SaveData {
  version: 1;
  mode: SavedMode;
  game: GameState;
  /** Для партии по сети — id второго телефона, чтобы пустить только его. */
  clientId?: string | null;
  savedAt: number;
}

const SAVE_KEY = 'warplanet.save.v1';
const CLIENT_ID_KEY = 'warplanet.clientId';
const NAME_KEY = 'warplanet.playerName';

export async function saveGame(data: Omit<SaveData, 'version' | 'savedAt'>): Promise<void> {
  try {
    const full: SaveData = { version: 1, savedAt: Date.now(), ...data };
    await AsyncStorage.setItem(SAVE_KEY, JSON.stringify(full));
  } catch {
    // Нет места или хранилище недоступно — игра продолжается без сохранения.
  }
}

export async function loadGame(): Promise<SaveData | null> {
  try {
    const raw = await AsyncStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 1 || !data.game || data.game.finished) return null;
    // Сохранение со старой версией карты (другое число клеток) продолжить нельзя.
    if (data.game.cells.length !== getMap(data.game.mapId).cells.length) return null;
    return data;
  } catch {
    return null;
  }
}

export async function clearSave(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SAVE_KEY);
  } catch {
    // ничего страшного
  }
}

/** Постоянный id устройства: по нему хост узнаёт клиента при переподключении. */
export async function getClientId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const id = `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
    await AsyncStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    return `c${Date.now().toString(36)}`;
  }
}

export async function getPlayerName(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(NAME_KEY)) || 'Игрок';
  } catch {
    return 'Игрок';
  }
}

export async function setPlayerName(name: string): Promise<void> {
  try {
    await AsyncStorage.setItem(NAME_KEY, name.trim().slice(0, 24));
  } catch {
    // ничего страшного
  }
}
