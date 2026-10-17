import { CONFIG, type EndReason, type GameState, type MapDef, type PlayerId, type TurnEvent } from '../engine';

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** ОД бывают дробными: 4.5. */
export function fmtAp(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

export const END_REASON: Record<EndReason, string> = {
  superiority: 'превосходство',
  domination: 'доминирование',
  annihilation: 'уничтожение соперников',
  flag: 'захват флага',
  turnLimit: 'лимит ходов',
  humansOut: 'все живые игроки выбыли',
};

export interface LogLine {
  text: string;
  /** Чей это результат — для цвета. */
  player: PlayerId | null;
  kind: 'good' | 'bad' | 'info';
}

/** Короткий журнал хода: бои, захваты, доход — с точки зрения игрока viewer. */
export function describeLog(
  game: GameState,
  map: MapDef,
  viewer: PlayerId | null,
  /** Туман войны: чужие бои вне этих клеток в журнал не попадают. */
  visible: ReadonlySet<number> | null = null,
): LogLine[] {
  const name = (id: PlayerId | null) => (id === null ? 'ополчение' : game.players[id]?.name ?? '?');
  const cell = (id: number) => map.cells[id]?.name ?? '?';
  const lines: LogLine[] = [];
  const mine = (id: PlayerId | null) => viewer !== null && id === viewer;
  for (const e of game.log as TurnEvent[]) {
    switch (e.t) {
      case 'income':
        if (mine(e.player)) {
          lines.push({
            text: `Доход +${e.income}, содержание армии −${e.upkeep}, в казне ${e.gold}`,
            player: e.player,
            kind: 'info',
          });
        }
        break;
      case 'unpaid':
        if (mine(e.player)) lines.push({ text: `Не хватило золота на армию: потеряно ${e.lost} солдат`, player: e.player, kind: 'bad' });
        break;
      // Формулировки без склонения названий: «Покупка — Вена: Италия».
      case 'recruit':
        if (mine(e.player)) lines.push({ text: `Найм — ${cell(e.cell)}: +${e.count} солдат`, player: e.player, kind: 'info' });
        break;
      case 'fortify':
        if (mine(e.player)) lines.push({ text: `Укрепление — ${cell(e.cell)}`, player: e.player, kind: 'info' });
        break;
      case 'buy':
        lines.push({ text: `Покупка — ${cell(e.cell)}: ${name(e.player)} (${e.cost} зол.)`, player: e.player, kind: mine(e.player) ? 'good' : 'info' });
        break;
      case 'loot':
        if (mine(e.player)) lines.push({ text: `Мародёрство — ${cell(e.cell)}: +${e.gold} зол.`, player: e.player, kind: 'info' });
        break;
      case 'festival':
        if (mine(e.player)) lines.push({ text: `Праздник — ${cell(e.cell)}: счастье +${CONFIG.actions.festival.happiness}%`, player: e.player, kind: 'info' });
        break;
      case 'war':
        lines.push({
          text: `Война: ${name(e.player)} объявляет войну стране «${name(e.target)}»`,
          player: e.player,
          kind: mine(e.target) ? 'bad' : 'info',
        });
        break;
      case 'battle': {
        if (visible && !mine(e.attacker) && !mine(e.defender) && !visible.has(e.cell)) break;
        const where = e.border ? `Встречный бой — ${cell(e.from!)} / ${cell(e.cell)}` : `Бой — ${cell(e.cell)}`;
        const won = e.winner !== null ? `победа: ${name(e.winner)}` : 'обе армии разбиты';
        const involved = mine(e.attacker) || mine(e.defender);
        lines.push({
          text: `${where}. Атака: ${name(e.attacker)} (${e.attack}), защита: ${name(e.defender)} (${e.defense}) — ${won}`,
          player: e.winner,
          kind: !involved ? 'info' : mine(e.winner) ? 'good' : 'bad',
        });
        break;
      }
      case 'revolt':
        lines.push({
          text: e.suppressed
            ? `Восстание подавлено — ${cell(e.cell)}: повстанцев ${e.rebels}, гарнизон ${e.garrison} → ${e.left}`
            : `Восстание — ${cell(e.cell)}: ${name(e.player)} теряет провинцию, у повстанцев ${e.left}`,
          player: e.player,
          kind: mine(e.player) ? (e.suppressed ? 'info' : 'bad') : 'info',
        });
        break;
      case 'capture':
        lines.push({
          text: `Захват — ${cell(e.cell)}: ${name(e.player)}${e.from !== null ? ` (прежде: ${name(e.from)})` : ''}`,
          player: e.player,
          kind: mine(e.player) ? 'good' : mine(e.from) ? 'bad' : 'info',
        });
        break;
      case 'capitalLost':
        lines.push({ text: `Потеряна столица — ${cell(e.cell)}: ${name(e.player)}`, player: e.player, kind: mine(e.player) ? 'bad' : 'info' });
        break;
      case 'eliminated':
        lines.push({ text: `Выбыл из игры: ${name(e.player)}`, player: e.player, kind: mine(e.player) ? 'bad' : 'info' });
        break;
      case 'victory':
        lines.push({
          text: e.player !== null ? `Победа: ${name(e.player)} (${END_REASON[e.reason]})` : `Партия окончена (${END_REASON[e.reason]})`,
          player: e.player,
          kind: mine(e.player) ? 'good' : 'info',
        });
        break;
    }
  }
  return lines;
}

export interface NewsItem {
  text: string;
  bad: boolean;
}

/**
 * Важное для игроков этого устройства в начале хода: кто объявил им войну и где были восстания.
 * Если игроков на устройстве двое, пишем по именам.
 */
export function newsFor(game: GameState, map: MapDef, viewers: PlayerId[]): { war: boolean; items: NewsItem[] } {
  const name = (id: PlayerId) => game.players[id]?.name ?? '?';
  const one = viewers.length === 1;
  const items: NewsItem[] = [];
  let war = false;
  for (const e of game.log) {
    if (e.t === 'war' && viewers.includes(e.target)) {
      war = true;
      items.push({ text: one ? `«${name(e.player)}» объявляет вам войну!` : `«${name(e.player)}» объявляет войну стране «${name(e.target)}»`, bad: true });
    }
    if (e.t === 'revolt' && viewers.includes(e.player)) {
      const where = map.cells[e.cell]?.name ?? '?';
      const whose = one ? '' : ` (${name(e.player)})`;
      items.push(
        e.suppressed
          ? { text: `Восстание в провинции ${where}${whose} подавлено: гарнизон ${e.garrison} → ${e.left}.`, bad: false }
          : { text: `Восстание в провинции ${where}${whose}: она стала ничейной, там ${e.left} повстанцев. Поднимите счастье или держите там армию.`, bad: true },
      );
    }
  }
  return { war, items };
}

export function difficultyLabel(d: keyof typeof CONFIG.ai.difficulties): string {
  return CONFIG.ai.difficulties[d].label;
}
