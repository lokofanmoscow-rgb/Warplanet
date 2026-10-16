import { CONFIG } from '../engine';
import { GameHost } from '../net/host';
import { publishGame } from '../net/discovery';
import { getNet } from '../net/platform';
import { MatchController } from './controller';
import { newMatch, type MatchSetup } from './match';
import { saveGame, type SaveData } from './storage';

/** Партия против ИИ или на одном телефоне. */
export function startLocal(mode: 'ai' | 'hotseat', setup: MatchSetup): MatchController {
  const game = newMatch(setup);
  void saveGame({ mode, game });
  return new MatchController(mode, game);
}

/** Хост для лобби: открывает порт и объявляет игру в сети. */
export async function createHost(hostName: string, mapId: string): Promise<{ host: GameHost; unpublish: () => void }> {
  const host = new GameHost({
    net: getNet(),
    port: CONFIG.net.port,
    hostName,
    mapId,
    onSave: (game, clientId) => void saveGame({ mode: 'host', game, clientId }),
  });
  const port = await host.start();
  const unpublish = publishGame(hostName, port);
  return { host, unpublish };
}

/** «Продолжить»: последняя сохранённая партия. */
export async function continueSaved(save: SaveData): Promise<MatchController> {
  if (save.mode === 'host') {
    const { host, unpublish } = await createHost(save.game.players[0]?.name ?? 'Хост', save.game.mapId);
    host.resume(save.game, save.clientId ?? null);
    const c = new MatchController('host', save.game, { host });
    const dispose = c.dispose.bind(c);
    c.dispose = () => {
      unpublish();
      dispose();
    };
    return c;
  }
  return new MatchController(save.mode, save.game);
}
