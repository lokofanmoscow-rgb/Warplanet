import {
  clampTax,
  simulatePlan,
  type Action,
  type GameState,
  type Move,
  type PlanResult,
  type PlayerId,
  type PlayerOrders,
  type TurnEvent,
} from '../engine';
import type { GameClient } from '../net/client';
import type { GameHost } from '../net/host';
import { runTurn } from './match';
import { saveGame, type SavedMode } from './storage';

export type Mode = 'ai' | 'hotseat' | 'host' | 'client';

type Edit = { kind: 'action' } | { kind: 'move' } | { kind: 'war' } | { kind: 'peace' };

/**
 * Партия на этом устройстве в любом режиме. Интерфейс видит одно и то же:
 * текущее состояние, черновик приказов активного игрока, готовность и журнал хода.
 */
export class MatchController {
  game: GameState;
  /** Игрок, чьи приказы сейчас отдаются на этом устройстве. */
  active: PlayerId;
  /** Черновики приказов локальных игроков. */
  drafts = new Map<PlayerId, PlayerOrders>();
  /** Локальные игроки, нажавшие «Готово» в этом ходу. */
  submitted = new Set<PlayerId>();
  /** На одном телефоне: экран «передайте телефон». */
  handoff: PlayerId | null = null;
  /** Журнал последнего рассчитанного хода — показывается после расчёта. */
  log: TurnEvent[] | null = null;
  busy = false;
  version = 0;

  private edits: Edit[] = [];
  private listeners = new Set<() => void>();
  private planCache: { key: string; result: PlanResult } | null = null;
  private unsubscribeNet: (() => void) | null = null;

  /** Сообщение для игрока (например, что хост вышел и партия продолжается на этом телефоне). */
  notice: string | null = null;

  constructor(
    /** Клиент становится 'ai', если выбывший хост вышел из игры. */
    public mode: Mode,
    game: GameState,
    private net: { host?: GameHost; client?: GameClient; clientId?: string | null } = {},
  ) {
    this.game = game;
    // Выбывшие игроки приказов не отдают — начинаем с первого живого.
    this.active = this.localPlayers().find((p) => game.players[p]?.alive) ?? this.localPlayers()[0] ?? 0;
    if (mode === 'hotseat') this.handoff = this.active;
    const source = net.host ?? net.client;
    if (source) this.unsubscribeNet = source.subscribe(() => this.syncFromNet());
  }

  // ---------- Подписка для React ----------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    this.planCache = null;
    this.listeners.forEach((l) => l());
  }

  // ---------- Кто играет на этом устройстве ----------

  localPlayers(): PlayerId[] {
    const humans = this.game.players.filter((p) => p.kind === 'human').map((p) => p.id);
    switch (this.mode) {
      case 'ai':
      case 'hotseat':
        return humans;
      case 'host':
        return [0];
      case 'client':
        return this.net.client?.slot != null ? [this.net.client.slot] : [1];
    }
  }

  get host(): GameHost | undefined {
    return this.net.host;
  }

  get client(): GameClient | undefined {
    return this.net.client;
  }

  /** Готовность всех игроков (для значка готовности второго игрока). */
  readyFlags(): boolean[] {
    if (this.mode === 'host') return this.net.host?.readyFlags() ?? [];
    if (this.mode === 'client') return this.net.client?.ready ?? [];
    return this.game.players.map((p) => p.kind !== 'human' || !p.alive || this.submitted.has(p.id));
  }

  isSubmitted(id: PlayerId = this.active): boolean {
    if (this.mode === 'client') return this.net.client?.sentTurn === this.game.turn;
    if (this.mode === 'host') return this.net.host?.orders.has(id) ?? false;
    return this.submitted.has(id);
  }

  canEdit(): boolean {
    const me = this.game.players[this.active];
    return !this.game.finished && !!me?.alive && !this.isSubmitted() && !this.busy && this.handoff === null;
  }

  // ---------- Черновик приказов ----------

  orders(id: PlayerId = this.active): PlayerOrders {
    let d = this.drafts.get(id);
    if (!d) {
      d = { tax: this.game.players[id]?.tax ?? 0, actions: [], moves: [], wars: [], peace: [] };
      this.drafts.set(id, d);
    }
    return d;
  }

  plan(): PlanResult {
    const o = this.orders();
    const key = `${this.version}:${this.active}`;
    if (this.planCache?.key === key) return this.planCache.result;
    const result = simulatePlan(this.game, this.active, o);
    this.planCache = { key, result };
    return result;
  }

  setTax(tax: number): void {
    if (!this.canEdit()) return;
    this.orders().tax = clampTax(tax);
    this.emit();
  }

  /**
   * Пробует черновик с изменением: ошибка самого изменения или уже отданных перемещений
   * (действия выполняются раньше перемещений и могут забрать нужные им ОД и золото).
   */
  private trial(next: PlayerOrders, own: (plan: PlanResult) => string | null): string | null {
    const plan = simulatePlan(this.game, this.active, next);
    const err = own(plan);
    if (err) return err;
    const broken = plan.moveErrors.find((e) => e !== null);
    return broken ? `Тогда не выйдут перемещения: ${broken.toLowerCase()}` : null;
  }

  /** Добавляет действие; возвращает текст ошибки, если оно невозможно. */
  addAction(action: Action): string | null {
    if (!this.canEdit()) return 'Приказы уже отданы';
    const o = this.orders();
    const err = this.trial({ ...o, actions: [...o.actions, action] }, (p) => p.actionErrors.at(-1) ?? null);
    if (err) return err;
    o.actions.push(action);
    this.edits.push({ kind: 'action' });
    this.emit();
    return null;
  }

  removeAction(index: number): void {
    if (!this.canEdit()) return;
    this.orders().actions.splice(index, 1);
    this.dropEdit('action');
    this.prune();
    this.emit();
  }

  /** Приказ на перемещение. Повторный приказ туда же складывается и ОД не тратит. Возвращает ошибку. */
  addMove(move: Move): string | null {
    if (!this.canEdit()) return 'Приказы уже отданы';
    const o = this.orders();
    const idx = o.moves.findIndex((m) => m.from === move.from && m.to === move.to);
    const merge = (m: Move): Move => {
      const cav = (m.cav ?? 0) + (move.cav ?? 0);
      const art = (m.art ?? 0) + (move.art ?? 0);
      return { from: m.from, to: m.to, count: m.count + move.count, ...(cav ? { cav } : {}), ...(art ? { art } : {}) };
    };
    const moves = idx >= 0 ? o.moves.map((m, i) => (i === idx ? merge(m) : m)) : [...o.moves, move];
    const err = this.trial({ ...o, moves }, (p) => p.moveErrors[idx >= 0 ? idx : moves.length - 1]);
    if (err) return err;
    if (idx >= 0) o.moves[idx] = moves[idx];
    else {
      o.moves.push(move);
      this.edits.push({ kind: 'move' });
    }
    this.emit();
    return null;
  }

  removeMove(index: number): void {
    if (!this.canEdit()) return;
    this.orders().moves.splice(index, 1);
    this.dropEdit('move');
    this.prune();
    this.emit();
  }

  /** Объявление войны стране target (действует сразу, можно в том же ходу атаковать). */
  declareWar(target: PlayerId): string | null {
    if (!this.canEdit()) return 'Приказы уже отданы';
    const o = this.orders();
    const wars = [...(o.wars ?? []), target];
    const err = this.trial({ ...o, wars }, (p) => p.warErrors.at(-1) ?? null);
    if (err) return err;
    o.wars = wars;
    this.edits.push({ kind: 'war' });
    this.emit();
    return null;
  }

  cancelWar(target: PlayerId): void {
    if (!this.canEdit()) return;
    const o = this.orders();
    o.wars = (o.wars ?? []).filter((t) => t !== target);
    this.dropEdit('war');
    this.prune();
    this.emit();
  }

  /** Предложение мира (или согласие на чужое предложение). Мир будет, если другая сторона тоже согласна. */
  offerPeace(target: PlayerId): string | null {
    if (!this.canEdit()) return 'Приказы уже отданы';
    const o = this.orders();
    const peace = [...(o.peace ?? []), target];
    const err = this.trial({ ...o, peace }, (p) => p.peaceErrors.at(-1) ?? null);
    if (err) return err;
    o.peace = peace;
    this.edits.push({ kind: 'peace' });
    this.emit();
    return null;
  }

  cancelPeace(target: PlayerId): void {
    if (!this.canEdit()) return;
    const o = this.orders();
    o.peace = (o.peace ?? []).filter((t) => t !== target);
    this.dropEdit('peace');
    this.emit();
  }

  /** После отмены приказа убираем те, что без него стали невозможны (например, атаку без войны). */
  private prune(): void {
    const o = this.orders();
    for (let i = 0; i < 4; i++) {
      const plan = simulatePlan(this.game, this.active, o);
      if (plan.actionErrors.every((e) => e === null) && plan.moveErrors.every((e) => e === null)) return;
      o.actions = o.actions.filter((_, j) => plan.actionErrors[j] === null);
      o.moves = o.moves.filter((_, j) => plan.moveErrors[j] === null);
    }
  }

  /** «Отменить последний». */
  undo(): void {
    if (!this.canEdit()) return;
    const o = this.orders();
    const last = this.edits.pop();
    if (last?.kind === 'move') o.moves.pop();
    else if (last?.kind === 'action') o.actions.pop();
    else if (last?.kind === 'war') o.wars?.pop();
    else if (last?.kind === 'peace') o.peace?.pop();
    else if (o.moves.length) o.moves.pop();
    else if (o.actions.length) o.actions.pop();
    else if (o.wars?.length) o.wars.pop();
    else o.peace?.pop();
    this.prune();
    this.emit();
  }

  get canUndo(): boolean {
    const o = this.orders();
    return this.canEdit() && (o.moves.length > 0 || o.actions.length > 0 || (o.wars?.length ?? 0) > 0 || (o.peace?.length ?? 0) > 0);
  }

  private dropEdit(kind: Edit['kind']): void {
    for (let i = this.edits.length - 1; i >= 0; i--) {
      if (this.edits[i].kind === kind) {
        this.edits.splice(i, 1);
        return;
      }
    }
  }

  // ---------- «Готово» и расчёт хода ----------

  ready(): void {
    if (!this.canEdit()) return;
    const id = this.active;
    const orders = this.orders(id);
    this.submitted.add(id);
    switch (this.mode) {
      case 'client':
        this.net.client?.sendOrders(orders);
        break;
      case 'host':
        this.net.host?.submitHostOrders(orders);
        break;
      case 'ai':
      case 'hotseat': {
        const next = this.localPlayers().find((p) => this.game.players[p].alive && !this.submitted.has(p));
        if (next !== undefined) {
          // На одном телефоне — передать ход следующему.
          this.active = next;
          this.handoff = next;
          this.edits = [];
        } else {
          this.resolveLocal();
        }
        break;
      }
    }
    this.emit();
  }

  /** Экран передачи телефона закрыт — игрок видит карту и отдаёт приказы. */
  takeOver(): void {
    this.handoff = null;
    this.emit();
  }

  dismissNotice(): void {
    this.notice = null;
    this.emit();
  }

  dismissLog(): void {
    this.log = null;
    this.emit();
  }

  private resolveLocal(): void {
    this.busy = true;
    this.emit();
    // Даём интерфейсу показать «Расчёт хода…», затем считаем.
    setTimeout(() => {
      const orders: Record<PlayerId, PlayerOrders> = {};
      for (const id of this.submitted) orders[id] = this.orders(id);
      this.applyNewState(runTurn(this.game, orders));
      this.busy = false;
      void saveGame({ mode: this.mode as SavedMode, game: this.game });
      this.emit();
    }, 30);
  }

  /** Новое состояние от хоста или после локального расчёта. */
  applyNewState(next: GameState): void {
    const newTurn = next.turn !== this.game.turn || (next.finished && !this.game.finished);
    this.game = next;
    if (!newTurn) {
      this.emit();
      return;
    }
    this.drafts.clear();
    this.submitted.clear();
    this.edits = [];
    this.log = next.log;
    const alive = this.localPlayers().filter((p) => next.players[p].alive);
    this.active = alive[0] ?? this.localPlayers()[0] ?? 0;
    if (this.mode === 'hotseat' && !next.finished && alive.length > 1) this.handoff = this.active;
    this.emit();
  }

  /** Сетевые режимы: хост или клиент сообщили об изменении. */
  syncFromNet(): void {
    const g = this.mode === 'host' ? this.net.host?.game : this.net.client?.game;
    if (g && g !== this.game) this.applyNewState(g);
    if (this.takeOverFromHost()) return;
    this.emit();
  }

  /**
   * Хост выбыл и связь с ним пропала (он вышел из игры): второй игрок доигрывает с ИИ
   * на этом телефоне — у клиента есть полное состояние партии, ходы ИИ считаются здесь.
   */
  private takeOverFromHost(): boolean {
    const client = this.net.client;
    if (this.mode !== 'client' || !client || client.status === 'connected' || client.status === 'connecting') return false;
    const g = this.game;
    if (g.finished || g.players[0]?.alive !== false || !g.players[this.active]?.alive) return false;
    this.unsubscribeNet?.();
    this.unsubscribeNet = null;
    client.close();
    this.net = {};
    this.mode = 'ai';
    // Приказы этого хода до хоста могли не дойти — «Готово» нажимается снова, черновик остаётся.
    this.submitted.clear();
    this.notice = 'Хост выбыл и вышел из игры. Вы доигрываете с ИИ на этом телефоне — партия сохраняется после каждого хода.';
    void saveGame({ mode: 'ai', game: g });
    this.emit();
    return true;
  }

  dispose(): void {
    this.unsubscribeNet?.();
    this.net.host?.stop();
    this.net.client?.close();
    this.listeners.clear();
  }
}
