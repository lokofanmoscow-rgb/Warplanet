import { Platform } from 'react-native';
import type { NetModule } from './transport';

/** Сеть работает только в нативной сборке (нужны нативные модули TCP и mDNS). */
export const networkAvailable = Platform.OS === 'android' || Platform.OS === 'ios';

export function getNet(): NetModule {
  if (!networkAvailable) throw new Error('Сеть недоступна на этой платформе');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-tcp-socket').default as NetModule;
}

/** IP телефона в Wi-Fi сети — хост показывает его в лобби. */
export async function getLocalIp(): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Network = require('expo-network') as typeof import('expo-network');
    const ip = await Network.getIpAddressAsync();
    return ip && ip !== '0.0.0.0' ? ip : null;
  } catch {
    return null;
  }
}
