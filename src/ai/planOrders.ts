import {
  actionError,
  applyAction,
  CONFIG,
  clampTax,
  cloneState,
  desert,
  developCost,
  EMPTY_SQUAD,
  getMap,
  happinessTarget,
  hasPeaceOffer,
  maxRecruit,
  newBudget,
  previewEconomy,
  atWar,
  reachable,
  simulatePlan,
  squadOf,
  squadPower,
  squadSize,
  subSquads,
  truceUntil,
  warError,
  warTurns,
  warWeariness,
  type Action,
  type AiCharacter,
  type CellId,
  type Difficulty,
  type GameState,
  type MapDef,
  type Move,
  type PlayerId,
  type PlayerOrders,
  type Reach,
  type Squad,
  type UnitType,
} from '../engine';

/** Налог: самый высокий, при котором счастье держится не ниже порога (с учётом усталости от войны). */
export function aiTax(weariness = 0): number {
  const E = CONFIG.economy;
  let best = E.taxMin;
  for (let t = E.taxMin; t <= E.taxMax; t += E.taxStep) {
    if (happinessTarget(t) - weariness >= CONFIG.ai.minHappiness) best = t;
  }
  return clampTax(best);
}

export interface AiProfile {
  label: string;
  attack: number;
  warRatio: number;
  fronts: number;
  develop: number;
  peaceAccept: number;
  peaceOffer: number;
  cav: number;
  art: number;
}

/** Повадки ИИ по характеру; без характера (старые сохранения) — обычный. */
export function profileOf(character: AiCharacter | undefined): AiProfile {
  return character ? CONFIG.ai.characters[character] : CONFIG.ai.balanced;
}

interface Target {
  cell: CellId;
  kind: 0 | 1 | 2; // 0 — нейтрал, 1 — враг, 2 — столица ближайшего врага
  defense: number;
}

/**
 * Приказы ИИ на ход. ИИ видит всю карту, союзов не заключает; войну объявляет тому, на кого нападает.
 * По порядку: налог → мир → цели → найм у угрожаемых границ → укрепление → покупка соседних нейтралов →
 * хозяйство → атака с перевесом → подтягивание армий к фронту; столица не остаётся без гарнизона.
 * Часть ОД заранее откладывается на перемещения (каждое стоит 0,5 ОД). Повадки зависят от характера.
 */
export function planOrders(state: GameState, playerId: PlayerId, difficulty: Difficulty): PlayerOrders {
  const map = getMap(state.mapId);
  const me = state.players[playerId];
  if (!me?.alive) return { tax: me?.tax ?? 0, actions: [], moves: [], wars: [], peace: [] };
  const D = CONFIG.ai.difficulties[difficulty];
  const P = profileOf(me.character);
  const attackRatio = D.attackRatio * P.attack;

  // 1. Налог (действует со следующего хода) и прогноз экономики этого хода — по действующему налогу.
  const tax = aiTax(warWeariness(state, playerId));
  const proj = cloneState(state);
  const eco = previewEconomy(state, map, playerId, me.tax);
  proj.players[playerId].tax = tax;
  proj.players[playerId].gold = eco.gold;
  if (!eco.paid) {
    for (const c of proj.cells) if (c.owner === playerId && c.troops > 0) desert(c);
  }
  const budget = newBudget(state, map, playerId);
  // ОД на перемещения: по половине на каждую армию, но не больше половины всех ОД.
  const armies = proj.cells.filter((c) => c.owner === playerId && c.troops > 0).length;
  const moveAp = Math.floor(Math.min(budget.ap / 2, CONFIG.move.ap * Math.max(2, armies)) * 2) / 2;
  budget.ap -= moveAp;
  const actions: Action[] = [];
  const tryAction = (a: Action): boolean => {
    if (budget.count >= D.maxActions) return false;
    if (actionError(proj, map, playerId, a, budget) !== null) return false;
    applyAction(proj, map, playerId, a, budget);
    actions.push(a);
    return true;
  };

  const cells = proj.cells;
  const isLand = (id: CellId) => map.cells[id].kind === 'land';
  const mine = (id: CellId) => cells[id].owner === playerId;
  // Опасен любой чужой, кроме тех, с кем перемирие: им нельзя даже объявить войну.
  const isEnemy = (owner: PlayerId | null) => owner !== null && owner !== playerId && truceUntil(proj, playerId, owner) === null;
  const attackOf = (id: CellId) => squadPower(squadOf(cells[id]), 'attack');
  const defensePowerOf = (id: CellId) => squadPower(squadOf(cells[id]), 'defense');

  // Угроза: самая сильная вражеская армия по соседству (сила в атаке).
  const threat = (id: CellId, except: CellId | null = null) =>
    map.cells[id].neighbors.reduce((m, n) => (n !== except && isEnemy(cells[n].owner) ? Math.max(m, attackOf(n)) : m), 0);
  // Оборона цели. Соседние армии хозяина успевают прийти на помощь до боя — берём половину.
  const defenseOf = (id: CellId) => {
    const c = cells[id];
    const mult = c.fortified && isLand(id) ? CONFIG.actions.fortify.defenseMult : 1;
    const help =
      c.owner === null || !isLand(id)
        ? 0
        : map.cells[id].neighbors.reduce((sum, n) => (isLand(n) && cells[n].owner === c.owner ? sum + defensePowerOf(n) : sum), 0);
    return (defensePowerOf(id) + help * 0.5) * mult * (isLand(id) ? 1 : CONFIG.battle.seaStrength);
  };

  // Мир: принимает предложение, пока не побеждает с запасом; сам предлагает, если проигрывает.
  // Долгая война утомляет — порог выше. Тех, кому предложен мир, в этом ходу не атакуем.
  const armyOf = (p: PlayerId) => cells.reduce((sum, c, i) => sum + (c.owner === p ? attackOf(i) : 0), 0);
  const peace = new Set<PlayerId>();
  for (const e of proj.players) {
    if (!e.alive || e.id === playerId || !atWar(proj, playerId, e.id)) continue;
    const ratio = armyOf(playerId) / Math.max(1, armyOf(e.id));
    const turns = warTurns(state, playerId, e.id);
    const tired = turns >= 12 ? 1.5 : 1;
    if (hasPeaceOffer(state, e.id, playerId) ? ratio < P.peaceAccept * tired : turns >= 2 && ratio < P.peaceOffer * tired) {
      peace.add(e.id);
    }
  }

  // Ближайший враг (по шагам) — его столица последняя в списке целей.
  const myCells = cells.map((_, i) => i).filter((i) => mine(i));
  const dist = bfs(map, myCells);
  let nearestEnemy: PlayerId | null = null;
  let nearestD = Infinity;
  for (const p of proj.players) {
    if (p.id === playerId || !p.alive || p.capital === null) continue;
    if (dist[p.capital] < nearestD) {
      nearestD = dist[p.capital];
      nearestEnemy = p.id;
    }
  }
  const enemyCapital = nearestEnemy !== null ? proj.players[nearestEnemy].capital : null;

  // 2. Цели: чужая суша у своей земли (армии подходят по своей земле) и у своих флотов.
  const targetsOf = (): Target[] => {
    const out: Target[] = [];
    const seen = new Set<CellId>();
    for (let id = 0; id < cells.length; id++) {
      if (!mine(id) || (!isLand(id) && cells[id].troops <= 0)) continue;
      for (const n of map.cells[id].neighbors) {
        if (seen.has(n) || !isLand(n) || mine(n)) continue;
        if (cells[n].owner !== null && peace.has(cells[n].owner!)) continue;
        seen.add(n);
        const kind = cells[n].owner === null ? 0 : n === enemyCapital ? 2 : 1;
        out.push({ cell: n, kind, defense: defenseOf(n) });
      }
    }
    // Слабые нейтралы, затем слабые враги, затем столица; внутри — слабее и богаче раньше.
    return out.sort((a, b) => a.kind - b.kind || a.defense - b.defense || map.cells[b.cell].pop - map.cells[a.cell].pop);
  };

  // Резерв: столица не пустеет, угрожаемая граница держит оборону.
  // Армия атакуемой провинции в расчёт угрозы не входит — если атака удастся, её не станет.
  const reserve = (id: CellId, except: CellId | null = null) => {
    if (!isLand(id)) return 0;
    const t = threat(id, except);
    const fort = cells[id].fortified ? CONFIG.actions.fortify.defenseMult : 1;
    const hold = Math.ceil((t * 1.1) / fort);
    if (id === me.capital) return Math.max(CONFIG.ai.capitalMinGarrison, hold);
    return t > 0 ? hold : 0;
  };

  // Расстояние до ближайшей чужой суши: суша дешевле моря, вражеские флоты на пути обходим.
  const goals = cells.map((_, i) => i).filter((i) => isLand(i) && !mine(i));
  const toFront = weightedDistance(map, goals, (id) => {
    if (isLand(id)) return mine(id) ? 1 : Infinity;
    return isEnemy(cells[id].owner) ? Infinity : 3;
  });

  // Найм: для обороны — пехота, для атаки и про запас — по характеру (кавалерия, пушки, пехота).
  const unitFor = (purpose: 'defend' | 'attack', cell: CellId): UnitType => {
    if (purpose === 'defend') return 'inf';
    const r = ((state.turn * 37 + cell * 61) % 100) / 100;
    return r < P.cav ? 'cav' : r < P.cav + P.art ? 'art' : 'inf';
  };
  const recruit = (cell: CellId, want: number, purpose: 'defend' | 'attack', goldShare = 1, min = 1, keepGold = 0): boolean => {
    const unit = unitFor(purpose, cell);
    const gold = (proj.players[playerId].gold - keepGold) * goldShare;
    const count = Math.min(maxRecruit(cells[cell].pop), want, Math.floor(gold / CONFIG.units[unit].gold));
    return count >= min && tryAction({ type: 'recruit', cell, count, unit });
  };

  // 4. Найм у угрожаемых границ: у соседа-врага армия сильнее гарнизона.
  const border = myCells.filter((id) => isLand(id) && threat(id) > defensePowerOf(id));
  border.sort((a, b) => (b === me.capital ? 1 : 0) - (a === me.capital ? 1 : 0) || threat(b) - defensePowerOf(b) - (threat(a) - defensePowerOf(a)));
  for (const id of border) recruit(id, Math.ceil(threat(id) * 1.1 - defensePowerOf(id)), 'defend');

  // 5. Укрепление угрожаемых границ.
  const threatened = myCells
    .filter((id) => isLand(id) && !cells[id].fortified && threat(id) > cells[id].troops * 0.5)
    .sort((a, b) => (b === me.capital ? 1 : 0) - (a === me.capital ? 1 : 0) || threat(b) - threat(a));
  for (const id of threatened) tryAction({ type: 'fortify', cell: id });

  // Атакующий найм: если до лучшей цели не хватает немного солдат — нанять у границы.
  const available = (id: CellId) => Math.max(0, cells[id].troops - reserve(id));
  for (const t of targetsOf().slice(0, 3)) {
    const owner = cells[t.cell].owner;
    // Новую войну тут не начинаем — её решает атака ниже.
    if (owner !== null && !atWar(proj, playerId, owner)) continue;
    const sources = map.cells[t.cell].neighbors.filter((n) => mine(n) && isLand(n));
    const have = sources.reduce((s, n) => s + available(n), 0);
    const need = Math.floor(t.defense * attackRatio) + 1 - have;
    if (need <= 0 || sources.length === 0) continue;
    const src = sources.sort((a, b) => maxRecruit(cells[b].pop) - maxRecruit(cells[a].pop))[0];
    // Половина золота остаётся на покупку провинций.
    recruit(src, need, 'attack', 0.6, need);
  }

  // Праздник там, где счастье близко к восстанию.
  const unhappy = myCells
    .filter((id) => isLand(id) && cells[id].happiness < CONFIG.revolt.below + 5)
    .sort((a, b) => cells[a].happiness - cells[b].happiness);
  for (const id of unhappy) tryAction({ type: 'festival', cell: id });

  // 6. Покупка соседних нейтралов на оставшееся золото.
  const buyable = cells
    .map((_, i) => i)
    .filter((i) => isLand(i) && cells[i].owner === null && map.cells[i].neighbors.some((n) => mine(n) && isLand(n)))
    .sort((a, b) => cells[b].pop - cells[a].pop);
  for (const id of buyable) tryAction({ type: 'buy', cell: id });

  // Запас золота — на три хода содержания, а без сухопутных соседей (остров) — ещё и на посадку
  // самой большой армии на корабли.
  const landlocked = !myCells.some((id) => isLand(id) && map.cells[id].neighbors.some((n) => isLand(n) && !mine(n)));
  const biggest = myCells.reduce((m, id) => (isLand(id) ? Math.max(m, cells[id].troops) : m), 0);
  const keep = eco.upkeep * 3 + (landlocked ? biggest * CONFIG.move.embarkGoldPerSoldier : 0);

  // Хозяйство: часть свободного золота — в развитие самых населённых спокойных провинций.
  const devBudget = Math.max(0, proj.players[playerId].gold - keep) * P.develop;
  let devSpent = 0;
  const devOrder = myCells
    .filter((id) => isLand(id) && threat(id) === 0 && developCost(cells[id].dev ?? 0) !== null)
    .sort((a, b) => cells[b].pop - cells[a].pop);
  for (const id of devOrder) {
    const cost = developCost(cells[id].dev ?? 0)!;
    if (devSpent + cost > devBudget) continue;
    if (tryAction({ type: 'develop', cell: id })) devSpent += cost;
  }

  // Остаток золота и ОД — в найм, ближе к фронту раньше.
  const recruitOrder = myCells
    .filter((i) => isLand(i))
    .sort((a, b) => toFront[a] - toFront[b] || threat(b) - threat(a) || cells[b].pop - cells[a].pop);
  for (const id of recruitOrder) recruit(id, Infinity, 'attack', 1, 3, keep);

  // 3. Перемещения на оставшиеся ОД. Достижимость считаем так, будто война идёт со всеми:
  // нужную войну ИИ объявит в этом же ходу.
  budget.ap += moveAp;
  const allWars = proj.players.flatMap((a) => proj.players.filter((b) => b.id > a.id).map((b) => [a.id, b.id] as [PlayerId, PlayerId]));
  const warView = { ...proj, wars: allWars };
  const reachOf = new Map<CellId, Map<CellId, Reach>>();
  const reach = (id: CellId) => {
    let r = reachOf.get(id);
    if (!r) reachOf.set(id, (r = reachable(warView, map, playerId, id)));
    return r;
  };
  const moves: Move[] = [];
  const wars = new Set<PlayerId>();
  const left: Squad[] = cells.map((c, i) => (mine(i) ? squadOf(c) : { ...EMPTY_SQUAD }));
  const free = (id: CellId, except: CellId | null = null) => Math.max(0, squadSize(left[id]) - reserve(id, except));
  let gold = proj.players[playerId].gold;
  const canMove = () => budget.ap >= CONFIG.move.ap - 1e-9;
  /**
   * До n солдат, которые дойдут за steps шагов (по суше — у каждого типа своя дальность).
   * В поход сначала идут кавалерия и пушки, пехота остаётся охранять.
   */
  const pick = (id: CellId, n: number, steps: number): Squad => {
    const out = { ...EMPTY_SQUAD };
    let k = n;
    for (const t of ['cav', 'art', 'inf'] as UnitType[]) {
      if (isLand(id) && CONFIG.units[t].range < steps) continue;
      const take = Math.min(left[id][t], k);
      out[t] = take;
      k -= take;
    }
    return out;
  };
  const order = (from: CellId, to: CellId, sq: Squad) => {
    const count = squadSize(sq);
    moves.push({ from, to, count, ...(sq.cav ? { cav: sq.cav } : {}), ...(sq.art ? { art: sq.art } : {}) });
    left[from] = subSquads(left[from], sq);
    budget.ap -= CONFIG.move.ap;
    if (!isLand(to) && isLand(from)) gold -= count * CONFIG.move.embarkGoldPerSoldier;
  };
  const armyCells = () => cells.map((_, i) => i).filter((i) => mine(i) && squadSize(left[i]) > 0);

  // Новую войну ИИ начинает осторожно: не больше одной за ход, не больше fronts войн сразу,
  // не во время перемирия и только против страны, чья армия слабее в warRatio раз.
  const fronts = proj.players.filter((p) => p.alive && atWar(proj, playerId, p.id) && !peace.has(p.id)).length;
  const mayFight = (owner: PlayerId | null) =>
    owner === null ||
    (!peace.has(owner) &&
      (atWar(proj, playerId, owner) ||
        wars.has(owner) ||
        (wars.size === 0 && fronts < P.fronts && warError(proj, playerId, owner) === null && armyOf(playerId) >= armyOf(owner) * P.warRatio)));

  // Атака с перевесом (по силе, а не по числу солдат). Несколько армий идут в одну провинцию вместе.
  for (const t of targetsOf()) {
    if (!canMove()) break;
    const owner = cells[t.cell].owner;
    if (!mayFight(owner)) continue;
    const offers = armyCells()
      .map((n) => {
        const r = reach(n).get(t.cell);
        if (r?.kind !== 'attack') return null;
        const sq = pick(n, free(n, t.cell), r.path.length - 1);
        return { n, steps: r.path.length - 1, sq, power: squadPower(sq, 'attack') };
      })
      .filter((x): x is { n: CellId; steps: number; sq: Squad; power: number } => x !== null && x.power > 0)
      .sort((a, b) => b.power - a.power);
    const total = offers.reduce((sum, x) => sum + x.power, 0);
    const need = t.defense > 0 ? t.defense * attackRatio + 1 : 1;
    if (total < need) continue;
    // Берём с запасом, чтобы новой провинции было чем защищаться.
    let want = Math.min(total, Math.max(need, need * 1.3));
    const sent: [CellId, Squad][] = [];
    let got = 0;
    for (const x of offers) {
      if (want <= 0 || budget.ap < CONFIG.move.ap * (sent.length + 1) - 1e-9) break;
      // Последней армии хватит части: берём солдат пропорционально нужной силе.
      const part = x.power <= want ? x.sq : pick(x.n, Math.ceil((squadSize(x.sq) * want) / x.power), x.steps);
      const power = squadPower(part, 'attack');
      if (power <= 0) continue;
      sent.push([x.n, part]);
      got += power;
      want -= power;
    }
    // Не хватило ОД собрать нужную армию — не атакуем вполсилы.
    if (got < need) continue;
    for (const [src, sq] of sent) order(src, t.cell, sq);
    if (owner !== null && !atWar(proj, playerId, owner)) wars.add(owner);
  }

  // Подтягивание армий к фронту: на несколько клеток по своей земле, флот — по морю.
  const idle = armyCells()
    .filter((id) => free(id) > 0)
    .sort((a, b) => toFront[b] - toFront[a]);
  for (const id of idle) {
    if (!canMove()) break;
    const n = free(id);
    // У границы армия ждёт, пока накопит перевес; в море — тоже, рядом с целью.
    if (map.cells[id].neighbors.some((x) => isLand(x) && !mine(x))) continue;
    let best: CellId | null = null;
    let bestSteps = Infinity;
    for (const [to, r] of reach(id)) {
      // Хоть кто-то из свободных должен дойти.
      if (squadSize(pick(id, n, r.path.length - 1)) === 0) continue;
      if (r.kind === 'attack' || r.kind === 'naval') continue;
      // В море выходим только крупной армией и если хватает золота на корабли.
      if (r.kind === 'embark' && (n < 15 || gold < n * CONFIG.move.embarkGoldPerSoldier)) continue;
      const steps = r.path.length - 1;
      const cur = best === null ? toFront[id] : toFront[best];
      if (toFront[to] < cur || (toFront[to] === cur && best !== null && steps < bestSteps)) {
        best = to;
        bestSteps = steps;
      }
    }
    if (best === null) continue;
    order(id, best, pick(id, n, bestSteps));
  }

  // Страховка: отбрасываем всё, что движок счёл бы невозможным.
  const orders: PlayerOrders = { tax, actions, moves, wars: [...wars], peace: [...peace] };
  const check = simulatePlan(state, playerId, orders);
  return {
    tax,
    actions: actions.filter((_, i) => check.actionErrors[i] === null),
    moves: moves.filter((_, i) => check.moveErrors[i] === null),
    wars: orders.wars!.filter((_, i) => check.warErrors[i] === null),
    peace: orders.peace!.filter((_, i) => check.peaceErrors[i] === null),
  };
}

function bfs(map: MapDef, sources: CellId[]): number[] {
  const dist = new Array<number>(map.cells.length).fill(Infinity);
  const queue = [...sources];
  for (const s of sources) dist[s] = 0;
  for (let i = 0; i < queue.length; i++) {
    for (const n of map.cells[queue[i]].neighbors) {
      if (dist[n] !== Infinity) continue;
      dist[n] = dist[queue[i]] + 1;
      queue.push(n);
    }
  }
  return dist;
}

/** Дейкстра от целей: стоимость входа в клетку задаёт cost (Infinity — непроходимо). */
function weightedDistance(map: MapDef, goals: CellId[], cost: (id: CellId) => number): number[] {
  const dist = new Array<number>(map.cells.length).fill(Infinity);
  const done = new Array<boolean>(map.cells.length).fill(false);
  for (const g of goals) dist[g] = 0;
  for (;;) {
    let cur = -1;
    for (let i = 0; i < dist.length; i++) if (!done[i] && dist[i] < Infinity && (cur < 0 || dist[i] < dist[cur])) cur = i;
    if (cur < 0) break;
    done[cur] = true;
    for (const n of map.cells[cur].neighbors) {
      const c = cost(n);
      if (c === Infinity) continue;
      if (dist[cur] + c < dist[n]) dist[n] = dist[cur] + c;
    }
  }
  return dist;
}

/** Приказы всех живых ИИ — хост считает их в начале хода по состоянию на начало хода. */
export function planAllAI(state: GameState): Record<PlayerId, PlayerOrders> {
  const out: Record<PlayerId, PlayerOrders> = {};
  for (const p of state.players) {
    if (p.alive && p.kind === 'ai') out[p.id] = planOrders(state, p.id, p.difficulty);
  }
  return out;
}
