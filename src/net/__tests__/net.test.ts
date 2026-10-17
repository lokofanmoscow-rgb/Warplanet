import { EventEmitter } from 'node:events';
import net from 'node:net';
import { CONFIG } from '../../engine';
import { encode, LineReader, type Message } from '../protocol';
import { GameHost } from '../host';
import { GameClient } from '../client';
import { probeHost, scanAddresses, subnetAddresses } from '../probe';
import type { NetModule, NetSocket } from '../transport';
import { DEFAULT_MAP_ID, getMap } from '../../maps';

const netModule = net as unknown as NetModule;
const timing = { pingIntervalMs: 50, timeoutMs: 400, reconnectWaitMs: 300, retryMs: 100 };

/**
 * Как react-native-tcp-socket на Android: подключение встаёт в очередь сетевого потока и идёт долго,
 * а запись до 'connect' бросает «Socket is closed.».
 */
function slowNet(delayMs: number): NetModule {
  return {
    createServer: (cb) => netModule.createServer(cb),
    createConnection(opts, cb) {
      let real: net.Socket | null = null;
      const s = Object.assign(new EventEmitter(), {
        pending: true,
        write(d: string) {
          if (s.pending || !real) throw new Error('Socket is closed.');
          return real.write(d);
        },
        destroy() {
          clearTimeout(t);
          if (real) real.destroy();
          else s.emit('close');
        },
      });
      const t = setTimeout(() => {
        real = net.createConnection(opts, () => {
          s.pending = false;
          s.emit('connect');
          cb?.();
        });
        real.on('data', (d) => s.emit('data', d));
        real.on('error', (e) => s.emit('error', e.message));
        real.on('close', () => s.emit('close'));
      }, delayMs);
      return s as unknown as NetSocket;
    },
  };
}

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

describe('протокол', () => {
  test('строки JSON собираются из любых кусков, кириллица не рвётся', () => {
    const got: Message[] = [];
    const r = new LineReader((m) => got.push(m));
    const line = encode({ type: 'hello', v: 1, clientId: 'x', name: 'Сергей' }) + encode({ type: 'ping', t: 5 });
    expect(/^[\x00-\x7f]*$/.test(line)).toBe(true);
    for (let i = 0; i < line.length; i += 3) r.push(line.slice(i, i + 3));
    expect(got).toEqual([
      { type: 'hello', v: 1, clientId: 'x', name: 'Сергей' },
      { type: 'ping', t: 5 },
    ]);
  });
});

describe('хост и клиент по TCP', () => {
  let host: GameHost;
  const clients: GameClient[] = [];
  const mk = (port: number, clientId = 'phone-b', name = 'Борис') => {
    const c = new GameClient({ net: netModule, host: '127.0.0.1', port, name, clientId, timing });
    clients.push(c);
    c.connect();
    return c;
  };

  beforeEach(async () => {
    host = new GameHost({ net: netModule, port: 47700 + Math.floor(Math.random() * 200), hostName: 'Анна', mapId: DEFAULT_MAP_ID, timing });
    await host.start();
  });
  afterEach(() => {
    clients.splice(0).forEach((c) => c.close());
    host.stop();
  });

  test('поиск перебором: хост отвечает на опрос именем, лобби не трогается', async () => {
    const r = await probeHost(netModule, '127.0.0.1', host.port, 2000);
    expect(r).toEqual({ hostName: 'Анна', sameVersion: true, phase: 'lobby' });
    expect(host.lobby.clientConnected).toBe(false);
    // Пустой порт — ничего.
    expect(await probeHost(netModule, '127.0.0.1', host.port + 1, 500)).toBeNull();
    const found: string[] = [];
    await scanAddresses(netModule, ['127.0.0.1'], host.port, (h) => found.push(h), () => false);
    await scanAddresses(netModule, ['127.0.0.1'], host.port + 1, (h) => found.push(`пусто ${h}`), () => false);
    expect(found).toEqual(['127.0.0.1']);
    expect(subnetAddresses('192.168.1.7')).toHaveLength(253);
    expect(new Set(subnetAddresses('192.168.1.7')).size).toBe(253);
    // Сначала соседние адреса: хост обычно получил адрес рядом.
    expect(subnetAddresses('192.168.1.7').slice(0, 3)).toEqual(['192.168.1.8', '192.168.1.6', '192.168.1.9']);
  });

  test('поиск перебором не забивает сетевой поток: не больше двух подключений сразу, у каждого таймаут', async () => {
    let active = 0;
    let maxActive = 0;
    const timeouts: (number | undefined)[] = [];
    const fake: NetModule = {
      createServer: netModule.createServer,
      createConnection(opts) {
        active++;
        maxActive = Math.max(maxActive, active);
        timeouts.push(opts.connectTimeout);
        let open = true;
        const s = Object.assign(new EventEmitter(), {
          write: () => true,
          destroy() {
            if (!open) return;
            open = false;
            active--;
            s.emit('close');
          },
        });
        // Адрес пуст: подключение падает по таймауту.
        setTimeout(() => s.emit('error', 'timeout'), 5);
        return s as unknown as NetSocket;
      },
    };
    await scanAddresses(fake, subnetAddresses('10.0.0.50').slice(0, 20), 1, () => {}, () => false);
    expect(timeouts).toHaveLength(20);
    expect(maxActive).toBe(CONFIG.net.probeParallel);
    expect(timeouts.every((t) => t === CONFIG.net.probeConnectMs)).toBe(true);
  });

  test('медленное подключение (как на Android) не обрывается пингом', async () => {
    const c = new GameClient({
      net: slowNet(timing.pingIntervalMs * 4),
      host: '127.0.0.1',
      port: host.port,
      name: 'Борис',
      clientId: 'slow',
      timing,
    });
    clients.push(c);
    c.connect();
    await waitFor(() => c.status === 'connected' && c.lobby !== null);
    expect(host.lobby.clientName).toBe('Борис');
  });

  test('лобби, старт и полная партия ходов', async () => {
    const c = mk(host.port);
    await waitFor(() => c.status === 'connected' && c.lobby !== null);
    expect(c.slot).toBe(1);
    expect(host.lobby.clientName).toBe('Борис');

    host.setSettings({ aiCount: 2, aiDifficulty: 'easy' });
    const map = getMap(DEFAULT_MAP_ID);
    host.setHostStart(map.startPoints[0]);
    // Чужая или несуществующая точка не принимается.
    c.setStart(map.startPoints[0]);
    await waitFor(() => c.lobby?.clientName === 'Борис');
    expect(host.lobby.starts[1]).toBeNull();
    c.setStart(map.startPoints[1]);
    await waitFor(() => c.lobby?.starts[1] === map.startPoints[1]);

    host.startGame(123);
    await waitFor(() => c.game !== null);
    expect(c.game!.players).toHaveLength(4);
    expect(c.game!.players[1].name).toBe('Борис');
    expect(c.game!.players[1].capital).toBe(map.startPoints[1]);

    for (let turn = 1; turn <= 3; turn++) {
      host.submitHostOrders({ tax: 50, actions: [], moves: [] });
      await waitFor(() => c.ready[0] === true);
      expect(host.game!.turn).toBe(turn);
      c.sendOrders({ tax: 80, actions: [], moves: [] });
      await waitFor(() => c.game!.turn === turn + 1);
      expect(c.game).toEqual(host.game);
    }
    expect(host.game!.players[1].tax).toBe(80);
  });

  test('смена карты в лобби: столицы сбрасываются, партия идёт на новой карте', async () => {
    const c = mk(host.port);
    await waitFor(() => c.status === 'connected' && c.lobby !== null);
    host.setHostStart(getMap(DEFAULT_MAP_ID).startPoints[0]);
    c.setStart(getMap(DEFAULT_MAP_ID).startPoints[1]);
    await waitFor(() => host.lobby.starts[1] !== null);
    host.setSettings({ mapId: 'africa' });
    await waitFor(() => c.lobby?.settings.mapId === 'africa');
    expect(c.lobby!.starts).toEqual([null, null]);
    const africa = getMap('africa');
    c.setStart(africa.startPoints[2]);
    await waitFor(() => host.lobby.starts[1] === africa.startPoints[2]);
    host.startGame(3);
    await waitFor(() => c.game !== null);
    expect(c.game!.mapId).toBe('africa');
    expect(c.game!.players[1].capital).toBe(africa.startPoints[2]);
  });

  test('хост отбрасывает невозможные приказы клиента', async () => {
    const c = mk(host.port);
    await waitFor(() => c.status === 'connected');
    host.startGame(7);
    await waitFor(() => c.game !== null);
    const cap = c.game!.players[1].capital!;
    host.submitHostOrders({ tax: 50, actions: [], moves: [] });
    c.sendOrders({ tax: 50, actions: [{ type: 'fortify', cell: c.game!.players[0].capital! }], moves: [{ from: cap, to: cap, count: 999 }] });
    await waitFor(() => c.game!.turn === 2);
    expect(host.game!.log.some((e) => e.t === 'fortify')).toBe(false);
  });

  test('второго клиента не пускают', async () => {
    const a = mk(host.port, 'a');
    await waitFor(() => a.status === 'connected');
    const b = mk(host.port, 'b');
    await waitFor(() => b.status === 'rejected');
    expect(b.reason).toMatch(/второй игрок/);
  });

  test('переподключение: клиент получает полное состояние, после ожидания хост ставит паузу', async () => {
    const c = mk(host.port);
    await waitFor(() => c.status === 'connected');
    host.startGame(9);
    await waitFor(() => c.game !== null);
    // Обрываем связь со стороны клиента: он сам переподключится.
    (c as any).conn.socket.destroy();
    await waitFor(() => host.disconnectedAt !== null);
    await waitFor(() => c.status === 'connected' && host.clientConnected);
    expect(host.disconnectedAt).toBeNull();
    expect(c.game!.turn).toBe(host.game!.turn);

    // Клиент ушёл насовсем — через reconnectWaitMs пауза.
    c.close();
    await waitFor(() => host.paused, 2000);
    // Вернулся с тем же id — пауза снимается.
    const back = mk(host.port);
    await waitFor(() => back.status === 'connected' && !host.paused);
    expect(back.game).toEqual(host.game);
  });

  test('продолжение сохранённой партии: хост ждёт того же клиента', async () => {
    const c = mk(host.port, 'saved-id');
    await waitFor(() => c.status === 'connected');
    const game = host.startGame(11);
    c.close();
    host.stop();

    const host2 = new GameHost({ net: netModule, port: host.port + 1, hostName: 'Анна', mapId: DEFAULT_MAP_ID, timing });
    await host2.start();
    host2.resume(game, 'saved-id');
    const stranger = mk(host2.port, 'other');
    await waitFor(() => stranger.status === 'rejected');
    const again = mk(host2.port, 'saved-id');
    await waitFor(() => again.game !== null);
    expect(again.game!.id).toBe(game.id);
    host2.stop();
  });

  test('нет хоста — клиент сообщает об ошибке с причиной', async () => {
    const c = mk(1);
    await waitFor(() => c.status === 'closed');
    expect(c.reason).toMatch(/^Не удалось подключиться: .*ECONNREFUSED/);
  });

  test('приказы, ушедшие в оборванное соединение, отправляются снова', async () => {
    const c = mk(host.port);
    await waitFor(() => c.status === 'connected');
    host.startGame(5);
    await waitFor(() => c.game !== null);
    (c as any).conn.socket.destroy();
    c.sendOrders({ tax: 70, actions: [], moves: [] });
    await waitFor(() => c.status === 'connected' && host.clientConnected);
    await waitFor(() => host.readyFlags()[1] === true);
    host.submitHostOrders({ tax: 50, actions: [], moves: [] });
    await waitFor(() => c.game!.turn === 2);
    expect(host.game!.players[1].tax).toBe(70);
  });
});
