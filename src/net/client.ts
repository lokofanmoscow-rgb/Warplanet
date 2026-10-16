import type { GameState, PlayerId, PlayerOrders } from '../engine';
import { PROTOCOL_VERSION, type HostMessage, type LobbyState, type Message } from './protocol';
import { Connection, DEFAULT_TIMING, type NetModule, type Timing } from './transport';

export type ClientStatus = 'connecting' | 'connected' | 'reconnecting' | 'rejected' | 'closed';

export interface ClientOptions {
  net: NetModule;
  host: string;
  port: number;
  name: string;
  /** Постоянный id устройства — по нему хост узнаёт игрока при переподключении. */
  clientId: string;
  timing?: Partial<Timing>;
  onChange?: () => void;
}

/** Клиент шлёт только приказы и получает от хоста полное состояние. */
export class GameClient {
  status: ClientStatus = 'connecting';
  reason: string | null = null;
  slot: PlayerId | null = null;
  hostName: string | null = null;
  lobby: LobbyState | null = null;
  game: GameState | null = null;
  ready: boolean[] = [];
  paused = false;
  /** Ход, приказы на который уже отправлены. */
  sentTurn: number | null = null;

  private conn: Connection | null = null;
  private start: number | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private timing: Timing;
  private stopped = false;
  private everConnected = false;

  constructor(private opts: ClientOptions) {
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
  }

  connect(): void {
    this.stopped = false;
    const socket = this.opts.net.createConnection({ host: this.opts.host, port: this.opts.port }, () => {
      this.send({ type: 'hello', v: PROTOCOL_VERSION, clientId: this.opts.clientId, name: this.opts.name, start: this.start });
    });
    const conn: Connection = new Connection(socket, this.timing, {
      onMessage: (m) => this.onMessage(m),
      onClose: () => this.onClose(conn),
    });
    this.conn = conn;
  }

  /** Выбор стартовой точки в лобби. */
  setStart(cell: number | null): void {
    this.start = cell;
    this.send({ type: 'hello', v: PROTOCOL_VERSION, clientId: this.opts.clientId, name: this.opts.name, start: cell });
  }

  /** «Готово»: после этого приказы этого хода не меняются. */
  sendOrders(orders: PlayerOrders): void {
    if (!this.game) return;
    this.sentTurn = this.game.turn;
    this.send({ type: 'orders', turn: this.game.turn, orders });
    this.changed();
  }

  close(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.status = 'closed';
    this.conn?.close();
    this.conn = null;
  }

  private send(msg: Message): void {
    this.conn?.send(msg);
  }

  private onMessage(raw: Message): void {
    const m = raw as HostMessage;
    switch (m.type) {
      case 'hello':
        if (!m.ok) {
          this.status = 'rejected';
          this.reason = m.reason;
          this.stopped = true;
        } else {
          this.status = 'connected';
          this.everConnected = true;
          this.slot = m.slot;
          this.hostName = m.hostName;
          this.reason = null;
        }
        break;
      case 'state':
        if (m.phase === 'lobby') {
          this.lobby = m.lobby;
          this.start = m.lobby.starts[1];
        } else {
          if (this.game && m.game.turn !== this.game.turn) this.sentTurn = null;
          this.game = m.game;
          this.ready = m.ready;
          this.paused = m.paused;
          // Хост знает, что мы уже готовы (например, после переподключения).
          if (this.slot !== null && m.ready[this.slot] && !m.game.finished) this.sentTurn = m.game.turn;
        }
        break;
      case 'game_over':
        this.game = m.game;
        break;
    }
    this.changed();
  }

  private onClose(conn: Connection): void {
    if (conn !== this.conn) return;
    this.conn = null;
    if (this.stopped || !this.everConnected) {
      if (this.status !== 'rejected') this.status = 'closed';
      if (!this.everConnected && !this.reason) this.reason = 'Не удалось подключиться';
      this.changed();
      return;
    }
    // Связь потеряна: пробуем снова, хост узнает нас по clientId и пришлёт полное состояние.
    this.status = 'reconnecting';
    this.changed();
    this.retry = setTimeout(() => {
      if (!this.stopped) this.connect();
    }, this.timing.retryMs);
  }

  private listeners = new Set<() => void>();

  /** Подписка на изменения (экраны и контроллер партии). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.opts.onChange?.();
    this.listeners.forEach((l) => l());
  }
}
