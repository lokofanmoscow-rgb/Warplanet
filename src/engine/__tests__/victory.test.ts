import { createGame } from '../setup';
import { resolveTurn } from '../turn';
import { blankState, lineMap, makeMap, own, ordersFor } from './helpers';

describe('выбывание и условия победы', () => {
  test('игрок без провинций и армий выбывает', () => {
    const map = makeMap('three', [{ n: [1] }, { n: [2] }, { n: [] }], [0, 1, 2]);
    const s = blankState(map, 3);
    own(s, 0, 0, 50);
    own(s, 1, 1, 0);
    own(s, 2, 2, 5);
    s.settings.victory = 'domination';
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 50 }] } }));
    expect(next.players[1].alive).toBe(false);
    expect(next.players[1].eliminatedTurn).toBe(1);
    expect(next.finished).toBe(false);
    expect(next.turn).toBe(2);
  });

  test('игрок только с армией в море не выбывает', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 1);
    own(s, 6, 1, 30);
    const next = resolveTurn(s, ordersFor(s, {}));
    expect(next.players[1].alive).toBe(true);
  });

  test('превосходство: контроль от 82% провинций суши', () => {
    const map = makeMap(
      'ten',
      Array.from({ length: 11 }, (_, i) => ({ n: i < 10 ? [i + 1] : [] })),
      [0, 10],
    );
    const s = blankState(map);
    for (let i = 0; i < 9; i++) own(s, i, 0, 1);
    own(s, 10, 1, 1);
    // 9 из 11 = 81,8% — мало
    let next = resolveTurn(s, ordersFor(s, {}));
    expect(next.finished).toBe(false);
    own(s, 9, 0, 1); // 10 из 11
    next = resolveTurn(s, ordersFor(s, {}));
    expect(next).toMatchObject({ finished: true, winner: 0, endReason: 'superiority' });
  });

  test('порог превосходства настраивается', () => {
    const map = lineMap();
    const s = blankState(map);
    s.settings.superiority = 50;
    for (let i = 0; i < 3; i++) own(s, i, 0, 1);
    own(s, 5, 1, 1);
    const next = resolveTurn(s, ordersFor(s, {}));
    expect(next).toMatchObject({ finished: true, winner: 0 });
  });

  test('доминирование: контроль всех провинций суши', () => {
    const map = lineMap();
    const s = blankState(map);
    s.settings.victory = 'domination';
    for (let i = 0; i < 5; i++) own(s, i, 0, 1);
    own(s, 7, 1, 10);
    let next = resolveTurn(s, ordersFor(s, {}));
    expect(next.finished).toBe(false);
    own(s, 5, 0, 1);
    next = resolveTurn(s, ordersFor(s, {}));
    expect(next).toMatchObject({ finished: true, winner: 0, endReason: 'domination' });
  });

  test('уничтожение: все соперники выбыли', () => {
    const map = lineMap();
    const s = blankState(map);
    s.settings.victory = 'annihilation';
    own(s, 0, 0, 50);
    own(s, 1, 1, 0);
    const next = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 50 }] } }));
    expect(next).toMatchObject({ finished: true, winner: 0, endReason: 'annihilation' });
  });

  test('захват флага: удерживать отмеченную провинцию N ходов подряд', () => {
    const map = lineMap();
    let s = blankState(map);
    s.settings.victory = 'flag';
    s.settings.flagCell = 2;
    s.settings.flagTurns = 3;
    own(s, 0, 0, 1);
    own(s, 2, 0, 10);
    own(s, 5, 1, 10);
    s = resolveTurn(s, ordersFor(s, {}));
    expect(s.flag).toEqual({ holder: 0, turns: 1 });
    s = resolveTurn(s, ordersFor(s, {}));
    expect(s.finished).toBe(false);
    s = resolveTurn(s, ordersFor(s, {}));
    expect(s).toMatchObject({ finished: true, winner: 0, endReason: 'flag' });
  });

  test('потеря флага сбрасывает счётчик', () => {
    const map = lineMap();
    let s = blankState(map);
    s.settings.victory = 'flag';
    s.settings.flagCell = 2;
    s.settings.flagTurns = 5;
    own(s, 2, 0, 1);
    own(s, 3, 1, 100);
    own(s, 0, 0, 1);
    s = resolveTurn(s, ordersFor(s, {}));
    expect(s.flag).toEqual({ holder: 0, turns: 1 });
    s = resolveTurn(s, ordersFor(s, { 1: { moves: [{ from: 3, to: 2, count: 100 }] } }));
    expect(s.flag).toEqual({ holder: 1, turns: 1 });
  });

  test('лимит ходов: побеждает тот, у кого больше провинций', () => {
    const map = lineMap();
    let s = blankState(map);
    s.settings.turnLimit = 2;
    own(s, 0, 0, 1);
    own(s, 4, 1, 1);
    own(s, 5, 1, 1);
    s = resolveTurn(s, ordersFor(s, {}));
    expect(s.finished).toBe(false);
    s = resolveTurn(s, ordersFor(s, {}));
    expect(s).toMatchObject({ finished: true, winner: 1, endReason: 'turnLimit' });
  });

  test('партия заканчивается, когда выбыли все живые игроки', () => {
    const map = makeMap('three2', [{ n: [1] }, { n: [2] }, { n: [] }], [0, 1, 2]);
    const s = blankState(map, 3);
    s.players[2].kind = 'ai';
    s.players[1].kind = 'ai';
    own(s, 0, 0, 0);
    own(s, 1, 1, 50);
    own(s, 2, 2, 5);
    const next = resolveTurn(s, ordersFor(s, { 1: { moves: [{ from: 1, to: 0, count: 50 }] } }));
    expect(next).toMatchObject({ finished: true, endReason: 'humansOut', winner: 1 });
  });

  test('после конца партии ход больше не считается', () => {
    const map = lineMap();
    const s = blankState(map);
    own(s, 0, 0, 50);
    own(s, 1, 1, 0);
    const done = resolveTurn(s, ordersFor(s, { 0: { moves: [{ from: 0, to: 1, count: 50 }] } }));
    expect(done.finished).toBe(true);
    expect(resolveTurn(done, ordersFor(done, {}))).toBe(done);
  });
});

describe('старт партии', () => {
  test('столица и две соседние провинции, 30 солдат, 50 золота, остальная суша нейтральна', () => {
    const map = makeMap('start', Array.from({ length: 10 }, (_, i) => ({ n: i < 9 ? [i + 1] : [], pop: 8000 })), [0, 9]);
    const s = createGame({
      map,
      seed: 7,
      players: [
        { name: 'А', kind: 'human', start: 0 },
        { name: 'ИИ', kind: 'ai', difficulty: 'hard' },
      ],
    });
    expect(s.players[0].capital).toBe(0);
    expect(s.players[1].capital).toBe(9);
    expect(s.cells.filter((c) => c.owner === 0)).toHaveLength(3);
    expect(s.cells.filter((c) => c.owner === 1)).toHaveLength(3);
    expect(s.cells[0].troops).toBe(30);
    expect(s.players[0].gold).toBe(50);
    expect(s.cells[4]).toMatchObject({ owner: null, troops: 8, happiness: 70 });
  });

  test('живой игрок не может занять чужую стартовую точку', () => {
    const map = lineMap();
    expect(() =>
      createGame({
        map,
        seed: 1,
        players: [
          { name: 'А', kind: 'human', start: 0 },
          { name: 'Б', kind: 'human', start: 0 },
        ],
      }),
    ).toThrow();
  });
});
