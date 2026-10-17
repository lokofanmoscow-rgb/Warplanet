import { CONFIG } from '../engine';
import { encode, LineReader, PROTOCOL_VERSION } from './protocol';
import type { NetModule, NetSocket } from './transport';

export interface ProbeResult {
  hostName: string;
  /** Совпадает ли версия игры (иначе подключиться не выйдет). */
  sameVersion: boolean;
  phase: 'lobby' | 'game';
}

/**
 * Есть ли по адресу хост WarPlanet: подключаемся, спрашиваем «кто тут» и ждём ответа не дольше timeoutMs.
 * Хост отвечает именем и закрывает соединение; до лобби такой опрос не доходит.
 */
export function probeHost(net: NetModule, host: string, port: number, timeoutMs = 1500): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    let done = false;
    let socket: NetSocket | null = null;
    const finish = (r: ProbeResult | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // уже закрыт
      }
      resolve(r);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const reader = new LineReader((m) => {
      if (m.type === 'probe' && 'hostName' in m) finish({ hostName: m.hostName, sameVersion: m.v === PROTOCOL_VERSION, phase: m.phase });
    });
    try {
      // Без connectTimeout подключение к пустому адресу висит секундами и держит сетевой поток.
      const connectTimeout = Math.min(CONFIG.net.probeConnectMs, timeoutMs);
      socket = net.createConnection({ host, port, connectTimeout }, () => socket?.write(encode({ type: 'probe' })));
      socket.on('data', (d) => reader.push(d));
      socket.on('error', () => finish(null));
      socket.on('close', () => finish(null));
    } catch {
      finish(null);
    }
  });
}

/** Адреса подсети /24 вокруг своего IP (кроме своего): сначала ближние — роутер раздаёт адреса подряд. */
export function subnetAddresses(ip: string): string[] {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return [];
  const base = `${m[1]}.${m[2]}.${m[3]}`;
  const own = Number(m[4]);
  const out: string[] = [];
  for (let d = 1; d < 254; d++) {
    for (const n of [own + d, own - d]) if (n >= 1 && n <= 254) out.push(`${base}.${n}`);
  }
  return out;
}

/**
 * Опрос адресов по нескольку сразу (CONFIG.net.probeParallel); найденные хосты отдаются сразу.
 * shouldStop() прерывает поиск: после него новых подключений нет, идущие закончатся за probeConnectMs.
 */
export async function scanAddresses(
  net: NetModule,
  addresses: string[],
  port: number,
  onFound: (host: string, r: ProbeResult) => void,
  shouldStop: () => boolean,
  parallel: number = CONFIG.net.probeParallel,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < addresses.length && !shouldStop()) {
      const a = addresses[next++];
      const r = await probeHost(net, a, port);
      if (r && !shouldStop()) onFound(a, r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
}
