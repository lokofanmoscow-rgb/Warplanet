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

/** Строка списка сохранений — без самой партии, чтобы список читался быстро. */
export interface SaveMeta {
  id: string;
  mode: SavedMode;
  mapId: string;
  turn: number;
  /** Число клеток карты на момент сохранения: карта могла измениться в новой версии. */
  cells: number;
  players: { name: string; color: string; human: boolean; alive: boolean }[];
  savedAt: number;
}

// Несколько партий: у каждой свой ключ, плюс список. Старое единственное сохранение переносится в список.
const INDEX_KEY = 'warplanet.saves.v2';
const OLD_SAVE_KEY = 'warplanet.save.v1';
const slotKey = (id: string) => `warplanet.save.${id}`;
const CLIENT_ID_KEY = 'warplanet.clientId';
const NAME_KEY = 'warplanet.playerName';

/** Больше стольких партий не храним: самая давняя удаляется. */
export const MAX_SAVES = 6;

function metaOf(data: SaveData): SaveMeta {
  const g = data.game;
  return {
    id: g.id,
    mode: data.mode,
    mapId: g.mapId,
    turn: g.turn,
    cells: g.cells.length,
    players: g.players.map((p) => ({ name: p.name, color: p.color, human: p.kind === 'human', alive: p.alive })),
    savedAt: data.savedAt,
  };
}

async function readIndex(): Promise<SaveMeta[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  const list = raw ? (JSON.parse(raw) as SaveMeta[]) : [];
  // Перенос сохранения из версий до 0.6.
  const old = await AsyncStorage.getItem(OLD_SAVE_KEY);
  if (old) {
    await AsyncStorage.removeItem(OLD_SAVE_KEY);
    try {
      const data = JSON.parse(old) as SaveData;
      if (data.version === 1 && data.game && !data.game.finished && !list.some((m) => m.id === data.game.id)) {
        await AsyncStorage.setItem(slotKey(data.game.id), old);
        list.unshift(metaOf(data));
        await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list));
      }
    } catch {
      // испорченное старое сохранение — просто забываем
    }
  }
  return list;
}

/** Можно ли продолжить: карта есть и не изменилась с момента сохранения. */
function playable(meta: SaveMeta): boolean {
  try {
    return getMap(meta.mapId).cells.length === meta.cells;
  } catch {
    return false;
  }
}

export async function saveGame(data: Omit<SaveData, 'version' | 'savedAt'>): Promise<void> {
  try {
    const full: SaveData = { version: 1, savedAt: Date.now(), ...data };
    await AsyncStorage.setItem(slotKey(full.game.id), JSON.stringify(full));
    const list = (await readIndex()).filter((m) => m.id !== full.game.id);
    list.unshift(metaOf(full));
    for (const extra of list.splice(MAX_SAVES)) await AsyncStorage.removeItem(slotKey(extra.id));
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    // Нет места или хранилище недоступно — игра продолжается без сохранения.
  }
}

/** Сохранённые партии, свежие первыми (только те, что можно продолжить). */
export async function listSaves(): Promise<SaveMeta[]> {
  try {
    return (await readIndex()).filter(playable).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function loadSave(id: string): Promise<SaveData | null> {
  try {
    const raw = await AsyncStorage.getItem(slotKey(id));
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

/** Самая свежая партия. */
export async function loadGame(): Promise<SaveData | null> {
  const [latest] = await listSaves();
  return latest ? loadSave(latest.id) : null;
}

export async function clearSave(id: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(slotKey(id));
    const list = (await readIndex()).filter((m) => m.id !== id);
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(list));
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
