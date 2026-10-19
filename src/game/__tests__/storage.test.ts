import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_MAP_ID } from '../../maps';
import { defaultSetup, newMatch } from '../match';
import { clearSave, listSaves, loadGame, loadSave, MAX_SAVES, saveGame } from '../storage';

const game = (seed: number) => newMatch({ ...defaultSetup(DEFAULT_MAP_ID), aiCount: 2, humans: [{ name: 'Я', start: null }], seed });

describe('сохранения', () => {
  beforeEach(() => AsyncStorage.clear());

  test('несколько партий, свежие первыми, не больше шести', async () => {
    for (let i = 1; i <= MAX_SAVES + 2; i++) {
      await saveGame({ mode: 'ai', game: game(i) });
      await new Promise((r) => setTimeout(r, 2));
    }
    const list = await listSaves();
    expect(list).toHaveLength(MAX_SAVES);
    expect(list[0].id).toBe(game(MAX_SAVES + 2).id);
    expect(await loadSave(game(1).id)).toBeNull();
    expect((await loadGame())?.game.id).toBe(game(MAX_SAVES + 2).id);
  });

  test('та же партия перезаписывается; удаление убирает её из списка', async () => {
    const g = game(5);
    await saveGame({ mode: 'ai', game: g });
    await saveGame({ mode: 'ai', game: { ...g, turn: 7 } });
    expect((await listSaves()).map((m) => m.turn)).toEqual([7]);
    await clearSave(g.id);
    expect(await listSaves()).toEqual([]);
  });

  test('сохранение из старой версии переносится в список', async () => {
    const g = game(9);
    await AsyncStorage.setItem('warplanet.save.v1', JSON.stringify({ version: 1, mode: 'hotseat', game: g, savedAt: 1 }));
    const list = await listSaves();
    expect(list.map((m) => [m.id, m.mode])).toEqual([[g.id, 'hotseat']]);
    expect((await loadSave(g.id))?.game.turn).toBe(g.turn);
    expect(await AsyncStorage.getItem('warplanet.save.v1')).toBeNull();
  });
});
