import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

// Звуки, музыка и вибрация. Звуки синтезирует tools/gen-sounds.mjs.
// Любая ошибка звука молча проглатывается: игра без звука лучше, чем упавшая игра.

export type Sfx =
  | 'click'
  | 'select'
  | 'error'
  | 'march'
  | 'coins'
  | 'build'
  | 'recruit'
  | 'battle'
  | 'turn'
  | 'war'
  | 'peace'
  | 'victory'
  | 'defeat';

const SOURCES: Record<Sfx, number> = {
  click: require('../../assets/sounds/click.wav'),
  select: require('../../assets/sounds/select.wav'),
  error: require('../../assets/sounds/error.wav'),
  march: require('../../assets/sounds/march.wav'),
  coins: require('../../assets/sounds/coins.wav'),
  build: require('../../assets/sounds/build.wav'),
  recruit: require('../../assets/sounds/recruit.wav'),
  battle: require('../../assets/sounds/battle.wav'),
  turn: require('../../assets/sounds/turn.wav'),
  war: require('../../assets/sounds/war.wav'),
  peace: require('../../assets/sounds/peace.wav'),
  victory: require('../../assets/sounds/victory.wav'),
  defeat: require('../../assets/sounds/defeat.wav'),
};
const MUSIC = require('../../assets/sounds/music.mp3');

/** Громкость эффектов: частые звуки интерфейса тише событий. */
const VOLUME: Partial<Record<Sfx, number>> = { click: 0.45, select: 0.35, error: 0.6, coins: 0.7, march: 0.7 };
const MUSIC_VOLUME = 0.3;

// ---------- Настройки ----------

export interface SoundPrefs {
  sound: boolean;
  music: boolean;
  vibration: boolean;
}

const PREFS_KEY = 'warplanet.prefs.v1';
let prefs: SoundPrefs = { sound: true, music: true, vibration: true };
const listeners = new Set<() => void>();

export function getPrefs(): SoundPrefs {
  return prefs;
}

export function setPrefs(patch: Partial<SoundPrefs>) {
  prefs = { ...prefs, ...patch };
  for (const l of listeners) l();
  AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
  syncMusic();
}

export function usePrefs(): SoundPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
}

// ---------- Эффекты ----------

const players = new Map<Sfx, AudioPlayer>();

function playerFor(name: Sfx): AudioPlayer {
  let p = players.get(name);
  if (!p) {
    p = createAudioPlayer(SOURCES[name]);
    p.volume = VOLUME[name] ?? 0.8;
    players.set(name, p);
  }
  return p;
}

/** Проиграть эффект с начала (повтор перебивает недоигранный). */
export function play(name: Sfx) {
  if (!prefs.sound) return;
  try {
    const p = playerFor(name);
    if (p.currentTime > 0) void p.seekTo(0).catch(() => {});
    p.play();
  } catch {
    // Нет звука — играем молча.
  }
  // В браузере музыка может начаться только после первого действия игрока.
  if (Platform.OS === 'web' && music && prefs.music && !music.playing) syncMusic();
}

// ---------- Вибрация ----------

export type Buzz = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

export function buzz(kind: Buzz) {
  if (!prefs.vibration || Platform.OS === 'web') return;
  const run =
    kind === 'success'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : kind === 'warning'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        : kind === 'error'
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          : Haptics.impactAsync(
              kind === 'heavy' ? Haptics.ImpactFeedbackStyle.Heavy : kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
            );
  run.catch(() => {});
}

/** Звук и вибрация вместе — для событий партии. */
export function feedback(name: Sfx, kind?: Buzz) {
  play(name);
  if (kind) buzz(kind);
}

// ---------- Музыка ----------

let music: AudioPlayer | null = null;
let appActive = AppState.currentState !== 'background';

function syncMusic() {
  try {
    if (prefs.music && appActive) {
      if (!music) {
        music = createAudioPlayer(MUSIC);
        music.loop = true;
        music.volume = MUSIC_VOLUME;
      }
      if (!music.playing) music.play();
    } else {
      music?.pause();
    }
  } catch {
    // Музыки не будет.
  }
}

let started = false;

/** Загрузить настройки, подготовить эффекты и включить музыку. Вызывается один раз при старте. */
export async function initSound() {
  if (started) return;
  started = true;
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (raw) prefs = { ...prefs, ...(JSON.parse(raw) as Partial<SoundPrefs>) };
    for (const l of listeners) l();
  } catch {
    // Настройки по умолчанию.
  }
  // Частые эффекты — заранее, чтобы первый щелчок не запаздывал.
  if (prefs.sound) for (const name of ['click', 'select', 'march', 'coins'] as Sfx[]) playerFor(name);
  AppState.addEventListener('change', (st) => {
    appActive = st === 'active';
    syncMusic();
  });
  syncMusic();
}
