import { getMap, sanitizeOrders, type GameState, type PlayerId, type PlayerOrders } from '../engine';
import { defaultSetup, newMatch, runTurn } from '../game/match';
import { PROTOCOL_VERSION, type ClientMessage, type LobbySettings, type LobbyState, type Message } from './protocol';
import { Connection, DEFAULT_TIMING, type NetModule, type NetServer, type Timing } from './transport';

export const HOST_SLOT: PlayerId = 0;
export const CLIENT_SLOT: PlayerId = 1;

export interface HostOptions {
  net: NetModule;
  port: number;
  hostName: string;
  mapId: string;
  timing?: Partial<Timing>;
  /** Вызывается при любом изменении (для перерисовки интерфейса). */
  onChange?: () => void;
  /** Хост сохраняет партию после каждого хода. */
  onSave?: (game: GameState, clientId: string | null) => void;
}

/**
 * Хост хранит единственное верное состояние. Клиент шлёт только приказы,
 * хост проверяет их по правилам, считает ход за всех (включая ИИ) и рассылает новое состояние.
 */
export class GameHost {
  phase: 'lobby' | 'game' = 'lobby';
  lobby: LobbyState;
  game: GameState | null = null;
  /** Приказы, отправленные в этом ходу (= нажато «Готово»). */
  orders = new Map<PlayerId, PlayerOrders>();
  paused = false;
  /** Когда отвалился клиент (для отсчёта двух минут). */
  disconnectedAt: number | null = null;
  port: number;
  error: string | null = null;

  private server: NetServer | null = null;
  private conn: Connection | null = null;
  private clientId: string | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private timing: Timing;

  constructor(private opts: HostOptions) {
    this.port = opts.port;
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
    const d = defaultSetup(opts.mapId);
    this.lobby = {
      hostName: opts.hostName,
      clientName: null,
      clientConnected: false,
      settings: { ...d, aiCount: 2 },
      starts: [null, null],
    };
  }

  /** Запуск сервера. Если порт занят — пробует следующие. */
  async start(): Promise<number> {
    let last = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      const port = this.opts.port + attempt;
      try {
        await this.listen(port);
        this.port = port;
        return port;
      } catch (e) {
        // порт занят — следующий
        last = e instanceof Error ? e.message : String(e);
      }
    }
    // Причину показываем: по ней видно, сеть это, разрешения или что-то ещё.
    throw new Error(`Не удалось открыть порт${last ? `: ${last}` : ''}`);
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.opts.net.createServer((socket) => this.accept(socket));
      let settled = false;
      server.on('error', (e) => {
        if (!settled) {
          settled = true;
          reject(e);
        } else {
          this.error = e.message;
          this.changed();
        }
      });
      server.listen({ port, host: '0.0.0.0' }, () => {
        settled = true;
        this.server = server;
        resolve();
      });
    });
  }

  stop(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.conn?.close();
    this.conn = null;
    try {
      this.server?.close();
    } catch {
      // уже закрыт
    }
    this.server = null;
  }

  get clientConnected(): boolean {
    return !!this.conn && !this.conn.isClosed;
  }

  // ---------- Лобби ----------

  setSettings(patch: Partial<LobbySettings>): void {
    // Другая карта — прежние стартовые точки к ней не относятся.
    if (patch.mapId !== undefined && patch.mapId !== this.lobby.settings.mapId) this.lobby.starts = [null, null];
    this.lobby.settings = { ...this.lobby.settings, ...patch };
    this.broadcastState();
  }

  setHostStart(cell: number | null): void {
    const start = this.validStart(cell, this.lobby.starts[1]);
    if (cell !== null && start === null) return;
    this.lobby.starts[0] = start;
    this.broadcastState();
  }

  /** Стартовая точка должна быть на карте и не занята другим игроком. */
  private validStart(cell: number | null, other: number | null): number | null {
    if (cell === null || cell === other) return null;
    return getMap(this.lobby.settings.mapId).startPoints.includes(cell) ? cell : null;
  }

  setHostName(name: string): void {
    this.lobby.hostName = name;
    this.broadcastState();
  }

  /** «Начать»: создаёт партию для двух живых игроков и ИИ. */
  startGame(seed?: number): GameState {
    const s = this.lobby.settings;
    this.game = newMatch({
      ...s,
      seed,
      humans: [
        { name: this.lobby.hostName, start: this.lobby.starts[0] },
        { name: this.lobby.clientName ?? 'Игрок 2', start: this.lobby.starts[1] },
      ],
    });
    this.phase = 'game';
    this.orders.clear();
    this.opts.onSave?.(this.game, this.clientId);
    this.broadcastState();
    return this.game;
  }

  /** Продолжение сохранённой партии: ждём, пока клиент переподключится. */
  resume(game: GameState, clientId: string | null): void {
    this.game = game;
    this.phase = 'game';
    this.clientId = clientId;
    this.lobby.clientName = game.players[CLIENT_SLOT]?.name ?? null;
    this.orders.clear();
    this.disconnectedAt = Date.now();
    this.schedulePause();
    this.changed();
  }

  // ---------- Ходы ----------

  /** Хост нажал «Готово». */
  submitHostOrders(orders: PlayerOrders): void {
    if (!this.game || this.game.finished) return;
    this.orders.set(HOST_SLOT, sanitizeOrders(this.game, HOST_SLOT, orders));
    this.tryResolve();
  }

  /** Готовность живых игроков: выбывшие считаются готовыми. */
  readyFlags(): boolean[] {
    if (!this.game) return [];
    return this.game.players.map((p) => p.kind !== 'human' || !p.alive || this.orders.has(p.id));
  }

  private tryResolve(): void {
    if (!this.game) return;
    const ready = this.readyFlags();
    if (!ready.every(Boolean)) {
      this.broadcastState();
      return;
    }
    const orders: Record<PlayerId, PlayerOrders> = {};
    for (const [id, o] of this.orders) orders[id] = o;
    this.game = runTurn(this.game, orders);
    this.orders.clear();
    this.opts.onSave?.(this.game, this.clientId);
    this.broadcastState();
    if (this.game.finished) this.conn?.send({ type: 'game_over', game: this.game });
  }

  // ---------- Соединение ----------

  private accept(socket: Parameters<Parameters<NetModule['createServer']>[0]>[0]): void {
    const conn: Connection = new Connection(socket, this.timing, {
      onMessage: (m) => this.onMessage(conn, m),
      onClose: () => this.onClose(conn),
    });
  }

  private onMessage(conn: Connection, raw: Message): void {
    const m = raw as ClientMessage;
    if (m.type === 'probe') {
      // Поиск игры перебором адресов: отвечаем, кто мы, и закрываем соединение.
      conn.send({ type: 'probe', v: PROTOCOL_VERSION, hostName: this.lobby.hostName, phase: this.phase });
      setTimeout(() => conn.close(), 100);
      return;
    }
    if (m.type === 'hello') return this.onHello(conn, m);
    if (conn !== this.conn) return;
    if (m.type === 'orders' && this.game && m.turn === this.game.turn && !this.game.finished) {
      this.orders.set(CLIENT_SLOT, sanitizeOrders(this.game, CLIENT_SLOT, m.orders));
      this.tryResolve();
    }
  }

  private onHello(conn: Connection, m: Extract<ClientMessage, { type: 'hello' }>): void {
    const reject = (reason: string) => {
      conn.send({ type: 'hello', v: PROTOCOL_VERSION, ok: false, reason });
      setTimeout(() => conn.close(), 200);
    };
    if (m.v !== PROTOCOL_VERSION) return reject('Другая версия игры');
    // Клиент уже есть: пускаем только его же (переподключение).
    const known = this.clientId !== null;
    if (known && m.clientId !== this.clientId) {
      if (this.phase === 'game' || this.clientConnected) return reject('В игре уже есть второй игрок');
    }
    if (this.phase === 'game' && !known) return reject('Партия уже идёт');
    if (this.conn && this.conn !== conn && !this.conn.isClosed) {
      // Старое соединение того же клиента — закрываем, оно мёртвое.
      const old = this.conn;
      this.conn = null;
      old.close();
    }
    this.conn = conn;
    this.clientId = m.clientId;
    this.disconnectedAt = null;
    this.paused = false;
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (this.phase === 'lobby') {
      this.lobby.clientName = m.name.slice(0, 24) || 'Игрок 2';
      if (m.start !== undefined) this.lobby.starts[1] = this.validStart(m.start, this.lobby.starts[0]);
    }
    this.lobby.clientConnected = true;
    conn.send({ type: 'hello', v: PROTOCOL_VERSION, ok: true, slot: CLIENT_SLOT, hostName: this.lobby.hostName });
    this.broadcastState();
  }

  private onClose(conn: Connection): void {
    if (conn !== this.conn) return;
    this.conn = null;
    this.lobby.clientConnected = false;
    if (this.phase === 'lobby') {
      // В лобби отвалившийся клиент просто освобождает место.
      this.clientId = null;
      this.lobby.clientName = null;
      this.lobby.starts[1] = null;
    } else {
      this.disconnectedAt = Date.now();
      this.schedulePause();
    }
    this.changed();
  }

  /** Хост ждёт отвалившегося игрока, затем ставит паузу. */
  private schedulePause(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => {
      if (!this.clientConnected) {
        this.paused = true;
        this.changed();
      }
    }, this.timing.reconnectWaitMs);
  }

  private broadcastState(): void {
    if (this.phase === 'lobby') {
      this.conn?.send({ type: 'state', phase: 'lobby', lobby: this.lobby });
    } else if (this.game) {
      this.conn?.send({ type: 'state', phase: 'game', game: this.game, ready: this.readyFlags(), paused: this.paused });
    }
    this.changed();
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
