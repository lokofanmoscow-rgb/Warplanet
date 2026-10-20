import { CONFIG, type Difficulty, type GameState, type PlayerId, type PlayerOrders, type StartMode, type VictoryType } from '../engine';

// Транспорт: TCP-сокет, сообщения в JSON, одно на строку.
// Типы сообщений: hello, orders, state, ping, game_over; probe — короткий опрос «кто тут» при поиске игры.

export const PROTOCOL_VERSION = CONFIG.net.protocolVersion;

export interface LobbySettings {
  mapId: string;
  victory: VictoryType;
  superiority: number;
  flagTurns: number;
  turnLimit: number;
  aiCount: number;
  aiDifficulty: Difficulty;
  startMode: StartMode;
}

export interface LobbyState {
  hostName: string;
  clientName: string | null;
  clientConnected: boolean;
  settings: LobbySettings;
  /** Стартовые точки живых игроков: [хост, клиент]. */
  starts: [number | null, number | null];
}

export type HostMessage =
  | { type: 'hello'; v: number; ok: true; slot: PlayerId; hostName: string }
  | { type: 'hello'; v: number; ok: false; reason: string }
  | { type: 'state'; phase: 'lobby'; lobby: LobbyState }
  | { type: 'state'; phase: 'game'; game: GameState; ready: boolean[]; paused: boolean }
  | { type: 'ping'; t: number; reply?: boolean }
  | { type: 'game_over'; game: GameState }
  | { type: 'probe'; v: number; hostName: string; phase: 'lobby' | 'game' };

export type ClientMessage =
  | { type: 'hello'; v: number; clientId: string; name: string; start?: number | null }
  | { type: 'orders'; turn: number; orders: PlayerOrders }
  | { type: 'ping'; t: number; reply?: boolean }
  | { type: 'probe' };

export type Message = HostMessage | ClientMessage;

/**
 * JSON в одну строку. Всё не-ASCII экранируется (\uXXXX), поэтому строку можно резать
 * на куски TCP где угодно — многобайтовые символы не разрываются.
 */
export function encode(msg: Message): string {
  return (
    JSON.stringify(msg).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n'
  );
}

/** Сборщик строк из потока: отдаёт целые сообщения, хвост ждёт следующего куска. */
export class LineReader {
  private buf = '';

  constructor(private onMessage: (msg: Message) => void, private onError?: (e: unknown) => void) {}

  push(chunk: unknown): void {
    this.buf += typeof chunk === 'string' ? chunk : String((chunk as { toString(): string }).toString());
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        this.onMessage(JSON.parse(line));
      } catch (e) {
        this.onError?.(e);
      }
    }
    // Защита от мусора без переводов строки.
    if (this.buf.length > 4_000_000) this.buf = '';
  }
}
