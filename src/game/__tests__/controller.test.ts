import net from 'node:net';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_MAP_ID, getMap } from '../../maps';
import { GameClient } from '../../net/client';
import { GameHost } from '../../net/host';
import type { NetModule } from '../../net/transport';
import { MatchController } from '../controller';
import { defaultSetup, newMatch } from '../match';
import { loadGame } from '../storage';

const netModule = net as unknown as NetModule;

function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (cond()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe('контроллер партии', () => {
  beforeEach(() => AsyncStorage.clear());

  test('против ИИ: приказы, «Готово», расчёт хода, сохранение', async () => {
    const map = getMap(DEFAULT_MAP_ID);
    const game = newMatch({ ...defaultSetup(DEFAULT_MAP_ID), aiCount: 3, humans: [{ name: 'Я', start: map.startPoints[0] }], seed: 5 });
    const c = new MatchController('ai', game);
    expect(c.handoff).toBeNull();
    const cap = game.players[0].capital!;
    expect(c.addAction({ type: 'recruit', cell: cap, count: 5 })).toBeNull();
    const to = map.cells[cap].neighbors.find((n) => map.cells[n].kind === 'land')!;
    expect(c.addMove({ from: cap, to, count: 10 })).toBeNull();
    expect(c.addMove({ from: cap, to: cap, count: 1 })).not.toBeNull();
    // найм 1 ОД + перемещение 0,5 ОД
    expect(c.plan().apLeft).toBe(c.plan().apTotal - 1.5);
    c.undo();
    expect(c.orders().moves).toHaveLength(0);
    c.setTax(90);
    c.ready();
    expect(c.canEdit()).toBe(false);
    await waitFor(() => c.game.turn === 2);
    expect(c.log).not.toBeNull();
    expect(c.game.players[0].tax).toBe(90);
    expect(c.orders().actions).toHaveLength(0);
    // Сохранение пишется асинхронно после расчёта.
    await new Promise((r) => setTimeout(r, 50));
    const save = await loadGame();
    expect(save?.mode).toBe('ai');
    expect(save?.game.turn).toBe(2);
  });

  test('на одном телефоне: передача хода между игроками', async () => {
    const game = newMatch({
      ...defaultSetup(DEFAULT_MAP_ID),
      aiCount: 1,
      humans: [
        { name: 'Аня', start: null },
        { name: 'Боря', start: null },
      ],
      seed: 9,
    });
    const c = new MatchController('hotseat', game);
    expect(c.handoff).toBe(0);
    expect(c.canEdit()).toBe(false);
    c.takeOver();
    expect(c.canEdit()).toBe(true);
    c.ready();
    expect(c.active).toBe(1);
    expect(c.handoff).toBe(1);
    c.takeOver();
    c.ready();
    await waitFor(() => c.game.turn === 2);
    expect(c.handoff).toBe(0);
    expect(c.active).toBe(0);
  });

  test('по сети: хост и клиент доигрывают ход через контроллеры', async () => {
    const timing = { pingIntervalMs: 50, timeoutMs: 1000, reconnectWaitMs: 500, retryMs: 100 };
    const host = new GameHost({ net: netModule, port: 48100 + Math.floor(Math.random() * 300), hostName: 'Хост', mapId: DEFAULT_MAP_ID, timing });
    await host.start();
    const client = new GameClient({ net: netModule, host: '127.0.0.1', port: host.port, name: 'Клиент', clientId: 'id-1', timing });
    client.connect();
    await waitFor(() => host.lobby.clientConnected);
    host.startGame(3);
    await waitFor(() => client.game !== null);
    const hc = new MatchController('host', host.game!, { host });
    const cc = new MatchController('client', client.game!, { client });
    expect(hc.active).toBe(0);
    expect(cc.active).toBe(1);

    cc.setTax(100);
    cc.ready();
    await waitFor(() => hc.readyFlags()[1] === true);
    expect(hc.isSubmitted()).toBe(false);
    hc.ready();
    await waitFor(() => hc.game.turn === 2 && cc.game.turn === 2);
    expect(cc.game).toEqual(hc.game);
    expect(cc.game.players[1].tax).toBe(100);
    expect(cc.canEdit()).toBe(true);
    expect(cc.log).not.toBeNull();

    cc.dispose();
    hc.dispose();
  });
});
