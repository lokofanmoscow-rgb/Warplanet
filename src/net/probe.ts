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
export function probeHost(net: NetModule, host: string, port: number, timeoutMs = 900): Promise<ProbeResult | null> {
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
      socket = net.createConnection({ host, port }, () => socket?.write(encode({ type: 'probe' })));
      socket.on('data', (d) => reader.push(d));
      socket.on('error', () => finish(null));
      socket.on('close', () => finish(null));
    } catch {
      finish(null);
    }
  });
}

/** Адреса подсети /24 вокруг своего IP (кроме своего). */
export function subnetAddresses(ip: string): string[] {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return [];
  const base = `${m[1]}.${m[2]}.${m[3]}`;
  return Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`).filter((a) => a !== ip);
}

/** Перебор адресов пачками; найденные хосты отдаются сразу. stop() прерывает поиск. */
export async function scanAddresses(
  net: NetModule,
  addresses: string[],
  port: number,
  onFound: (host: string, r: ProbeResult) => void,
  shouldStop: () => boolean,
  batch = 32,
): Promise<void> {
  for (let i = 0; i < addresses.length && !shouldStop(); i += batch) {
    await Promise.all(
      addresses.slice(i, i + batch).map(async (a) => {
        const r = await probeHost(net, a, port);
        if (r && !shouldStop()) onFound(a, r);
      }),
    );
  }
}
