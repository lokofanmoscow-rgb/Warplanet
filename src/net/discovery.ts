import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../engine';
import { networkAvailable } from './platform';

// Обнаружение: хост объявляет себя через mDNS/NSD как _conquest._tcp, клиент видит список игр.
// MulticastLock на время поиска берёт сама библиотека react-native-zeroconf.

type ZeroconfType = import('react-native-zeroconf').default;

let shared: ZeroconfType | null = null;
function zeroconf(): ZeroconfType | null {
  if (!networkAvailable) return null;
  if (!shared) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Zeroconf = require('react-native-zeroconf').default;
    shared = new Zeroconf() as ZeroconfType;
  }
  return shared;
}

export interface FoundHost {
  key: string;
  name: string;
  host: string;
  port: number;
}

/** Объявить игру в сети. Возвращает функцию, снимающую объявление. */
export function publishGame(hostName: string, port: number): () => void {
  const zc = zeroconf();
  if (!zc) return () => {};
  const name = `WarPlanet ${hostName}`.slice(0, 60);
  let published: string | null = null;
  zc.publishService({
    type: CONFIG.net.serviceType,
    protocol: 'tcp',
    domain: 'local.',
    name,
    port,
    txt: { player: hostName, v: String(CONFIG.net.protocolVersion) },
  })
    .then((s) => {
      published = s.name;
    })
    .catch(() => {});
  return () => {
    if (published) zc.unpublishService(published).catch(() => {});
    else zc.unpublishService(name).catch(() => {});
  };
}

/** Поиск игр в сети, пока компонент на экране. */
export function useGameScan(enabled: boolean): { hosts: FoundHost[]; scanning: boolean; error: string | null } {
  const [hosts, setHosts] = useState<FoundHost[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zcRef = useRef<ZeroconfType | null>(null);

  useEffect(() => {
    const zc = zeroconf();
    if (!enabled || !zc) return;
    zcRef.current = zc;
    const refresh = () => {
      const list = Object.values(zc.getServices())
        .filter((s) => s.port && (s.ipv4?.length || s.addresses?.length))
        .map((s) => ({
          key: s.fullName || s.name,
          name: s.txt?.player || s.name.replace(/^WarPlanet\s*/, ''),
          host: s.ipv4?.[0] ?? s.addresses[0],
          port: s.port,
        }));
      setHosts(list);
    };
    const subs = [
      zc.subscribe('resolved', refresh),
      zc.subscribe('remove', refresh),
      zc.subscribe('update', refresh),
      zc.subscribe('start', () => setScanning(true)),
      zc.subscribe('stop', () => setScanning(false)),
      zc.subscribe('error', (e) => setError(e.message)),
    ];
    zc.checkLocalNetworkAccess({ type: CONFIG.net.serviceType })
      .catch(() => 'unknown')
      .finally(() => zc.scan({ type: CONFIG.net.serviceType, protocol: 'tcp', domain: 'local.' }));
    return () => {
      subs.forEach((u) => u());
      try {
        zc.stop();
      } catch {
        // уже остановлен
      }
    };
  }, [enabled]);

  return { hosts, scanning, error };
}
