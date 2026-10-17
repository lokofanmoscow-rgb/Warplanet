import { CONFIG } from '../engine';
import { encode, LineReader, type Message } from './protocol';

// Минимальный общий интерфейс Node `net` и react-native-tcp-socket.

export interface NetSocket {
  write(data: string): unknown;
  destroy(): unknown;
  on(event: 'data', cb: (data: unknown) => void): unknown;
  on(event: 'close' | 'connect', cb: () => void): unknown;
  // react-native-tcp-socket передаёт в 'error' строку, Node — Error.
  on(event: 'error', cb: (e: Error | string) => void): unknown;
  setNoDelay?(noDelay?: boolean): unknown;
  remoteAddress?: string;
  /** Соединение ещё устанавливается (в react-native-tcp-socket запись в это время бросает ошибку). */
  pending?: boolean;
}

export interface NetServer {
  listen(options: { port: number; host?: string }, cb?: () => void): unknown;
  close(cb?: (err?: Error) => void): unknown;
  on(event: 'error', cb: (e: Error) => void): unknown;
}

export interface NetModule {
  createServer(cb: (socket: NetSocket) => void): NetServer;
  /** connectTimeout понимает react-native-tcp-socket; Node его игнорирует. */
  createConnection(options: { host: string; port: number; connectTimeout?: number }, cb?: () => void): NetSocket;
}

export interface Timing {
  pingIntervalMs: number;
  timeoutMs: number;
  reconnectWaitMs: number;
  retryMs: number;
}

export const DEFAULT_TIMING: Timing = {
  pingIntervalMs: CONFIG.net.pingIntervalMs,
  timeoutMs: CONFIG.net.timeoutMs,
  reconnectWaitMs: CONFIG.net.reconnectWaitMs,
  retryMs: 3000,
};

/** Сокет с разбором строк, пингом и таймаутом молчания. */
export class Connection {
  /** Почему закрылось: текст ошибки сокета или таймаут. */
  error: string | null = null;
  private reader: LineReader;
  private lastSeen = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    readonly socket: NetSocket,
    private timing: Timing,
    private handlers: { onMessage: (m: Message) => void; onClose: () => void },
  ) {
    this.reader = new LineReader((m) => {
      if (m.type === 'ping') {
        if (!m.reply) this.send({ type: 'ping', t: m.t, reply: true });
        return;
      }
      handlers.onMessage(m);
    });
    socket.setNoDelay?.(true);
    socket.on('data', (d) => {
      this.lastSeen = Date.now();
      this.reader.push(d);
    });
    socket.on('error', (e) => {
      this.error ??= (typeof e === 'string' ? e : e?.message) || 'ошибка сети';
      this.close();
    });
    socket.on('close', () => this.close());
    this.timer = setInterval(() => {
      if (Date.now() - this.lastSeen > timing.timeoutMs) {
        this.error ??= socket.pending ? 'хост не отвечает' : 'связь пропала';
        return this.close();
      }
      this.send({ type: 'ping', t: Date.now() });
    }, timing.pingIntervalMs);
  }

  send(msg: Message): void {
    // Пока соединение устанавливается, писать нельзя: пинг подождёт, а hello уйдёт по 'connect'.
    if (this.closed || this.socket.pending) return;
    try {
      this.socket.write(encode(msg));
    } catch (e) {
      this.error ??= e instanceof Error ? e.message : 'ошибка записи';
      this.close();
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    try {
      this.socket.destroy();
    } catch {
      // уже закрыт
    }
    this.handlers.onClose();
  }
}
