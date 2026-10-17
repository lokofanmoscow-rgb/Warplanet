import {
  actionError,
  applyAction,
  CONFIG,
  clampTax,
  cloneState,
  getMap,
  happinessTarget,
  maxRecruit,
  newBudget,
  previewEconomy,
  atWar,
  reachable,
  simulatePlan,
  unpaidLoss,
  type Action,
  type CellId,
  type Difficulty,
  type GameState,
  type MapDef,
  type Move,
  type PlayerId,
  type PlayerOrders,
  type Reach,
} from '../engine';

/** Налог: самый высокий, при котором счастье держится не ниже порога. */
export function aiTax(): number {
  const E = CONFIG.economy;
  let best = E.taxMin;
  for (let t = E.taxMin; t <= E.taxMax; t += E.taxStep) {
    if (happinessTarget(t) >= CONFIG.ai.minHappiness) best = t;
  }
  return clampTax(best);
}

interface Target {
  cell: CellId;
  kind: 0 | 1 | 2; // 0 — нейтрал, 1 — враг, 2 — столица ближайшего врага
  defense: number;
}

/**
 * Приказы ИИ на ход. ИИ видит всю карту, союзов не заключает; войну объявляет тому, на кого нападает.
 * По порядку: налог → цели → найм у угрожаемых границ → укрепление → покупка соседних нейтралов →
 * атака с перевесом → подтягивание армий к фронту; столица не остаётся без гарнизона.
 * Часть ОД заранее откладывается на перемещения (каждое стоит 0,5 ОД).
 */
export function planOrders(state: GameState, playerId: PlayerId, difficulty: Difficulty): PlayerOrders {
  const map = getMap(state.mapId);
  const me = state.players[playerId];
  if (!me?.alive) return { tax: me?.tax ?? 0, actions: [], moves: [], wars: [] };
  const D = CONFIG.ai.difficulties[difficulty];

  // 1. Налог и прогноз экономики хода.
  const tax = aiTax();
  const proj = cloneState(state);
  const eco = previewEconomy(state, map, playerId, tax);
  proj.players[playerId].tax = tax;
  proj.players[playerId].gold = eco.gold;
  if (!eco.paid) {
    for (const c of proj.cells) if (c.owner === playerId && c.troops > 0) c.troops -= unpaidLoss(c.troops);
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
  const isEnemy = (owner: PlayerId | null) => owner !== null && owner !== playerId;

  // Угроза: самая большая вражеская армия по соседству.
  const threat = (id: CellId, except: CellId | null = null) =>
    map.cells[id].neighbors.reduce((m, n) => (n !== except && isEnemy(cells[n].owner) ? Math.max(m, cells[n].troops) : m), 0);
  // Оборона цели. Соседние армии хозяина успевают прийти на помощь до боя — берём половину.
  const defenseOf = (id: CellId) => {
    const c = cells[id];
    const mult = c.fortified && isLand(id) ? CONFIG.actions.fortify.defenseMult : 1;
    const help =
      c.owner === null || !isLand(id)
        ? 0
        : map.cells[id].neighbors.reduce((sum, n) => (isLand(n) && cells[n].owner === c.owner ? sum + cells[n].troops : sum), 0);
    return (c.troops + help * 0.5) * mult * (isLand(id) ? 1 : CONFIG.battle.seaStrength);
  };

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

  // 4. Найм у угрожаемых границ: у соседа-врага армия больше гарнизона.
  const border = myCells.filter((id) => isLand(id) && threat(id) > cells[id].troops);
  border.sort((a, b) => (b === me.capital ? 1 : 0) - (a === me.capital ? 1 : 0) || threat(b) - cells[b].troops - (threat(a) - cells[a].troops));
  for (const id of border) {
    const need = Math.ceil(threat(id) * 1.1) - cells[id].troops;
    const gold = proj.players[playerId].gold;
    const count = Math.min(maxRecruit(cells[id].pop), need, Math.floor(gold / CONFIG.actions.recruit.goldPerSoldier));
    if (count > 0) tryAction({ type: 'recruit', cell: id, count });
  }

  // 5. Укрепление угрожаемых границ.
  const threatened = myCells
    .filter((id) => isLand(id) && !cells[id].fortified && threat(id) > cells[id].troops * 0.5)
    .sort((a, b) => (b === me.capital ? 1 : 0) - (a === me.capital ? 1 : 0) || threat(b) - threat(a));
  for (const id of threatened) tryAction({ type: 'fortify', cell: id });

  // Атакующий найм: если до лучшей цели не хватает немного солдат — нанять у границы.
  const available = (id: CellId) => Math.max(0, cells[id].troops - reserve(id));
  for (const t of targetsOf().slice(0, 3)) {
    const sources = map.cells[t.cell].neighbors.filter((n) => mine(n) && isLand(n));
    const have = sources.reduce((s, n) => s + available(n), 0);
    const need = Math.floor(t.defense * D.attackRatio) + 1 - have;
    if (need <= 0 || sources.length === 0) continue;
    const src = sources.sort((a, b) => maxRecruit(cells[b].pop) - maxRecruit(cells[a].pop))[0];
    const gold = proj.players[playerId].gold;
    // Половина золота остаётся на покупку провинций.
    const affordable = Math.floor((gold * 0.6) / CONFIG.actions.recruit.goldPerSoldier);
    if (need <= Math.min(maxRecruit(cells[src].pop), affordable)) {
      tryAction({ type: 'recruit', cell: src, count: need });
    }
  }

  // 6. Покупка соседних нейтралов на оставшееся золото.
  const buyable = cells
    .map((_, i) => i)
    .filter((i) => isLand(i) && cells[i].owner === null && map.cells[i].neighbors.some((n) => mine(n) && isLand(n)))
    .sort((a, b) => cells[b].pop - cells[a].pop);
  for (const id of buyable) tryAction({ type: 'buy', cell: id });

  // Остаток золота и ОД — в найм, ближе к фронту раньше. Запас золота — на три хода содержания,
  // а без сухопутных соседей (остров) — ещё и на посадку самой большой армии на корабли.
  const landlocked = !myCells.some((id) => isLand(id) && map.cells[id].neighbors.some((n) => isLand(n) && !mine(n)));
  const biggest = myCells.reduce((m, id) => (isLand(id) ? Math.max(m, cells[id].troops) : m), 0);
  const keep = eco.upkeep * 3 + (landlocked ? biggest * CONFIG.move.embarkGoldPerSoldier : 0);
  const recruitOrder = myCells
    .filter((i) => isLand(i))
    .sort((a, b) => toFront[a] - toFront[b] || threat(b) - threat(a) || cells[b].pop - cells[a].pop);
  for (const id of recruitOrder) {
    const gold = proj.players[playerId].gold - keep;
    const count = Math.min(maxRecruit(cells[id].pop), Math.floor(gold / CONFIG.actions.recruit.goldPerSoldier));
    if (count >= 3) tryAction({ type: 'recruit', cell: id, count });
  }

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
  const left = cells.map((c, i) => (mine(i) ? c.troops : 0));
  const free = (id: CellId, except: CellId | null = null) => Math.max(0, left[id] - reserve(id, except));
  let gold = proj.players[playerId].gold;
  const canMove = () => budget.ap >= CONFIG.move.ap - 1e-9;
  const order = (from: CellId, to: CellId, count: number) => {
    moves.push({ from, to, count });
    left[from] -= count;
    budget.ap -= CONFIG.move.ap;
    if (!isLand(to) && isLand(from)) gold -= count * CONFIG.move.embarkGoldPerSoldier;
  };
  const armyCells = () => cells.map((_, i) => i).filter((i) => mine(i) && left[i] > 0);

  // Новую войну ИИ начинает осторожно: не больше одной за ход, не на третьем фронте
  // и только против страны, чья армия заметно слабее.
  const armyOf = (p: PlayerId) => cells.reduce((sum, c) => sum + (c.owner === p ? c.troops : 0), 0);
  const fronts = proj.players.filter((p) => p.alive && atWar(proj, playerId, p.id)).length;
  const mayFight = (owner: PlayerId | null) =>
    owner === null ||
    atWar(proj, playerId, owner) ||
    wars.has(owner) ||
    (wars.size === 0 && fronts < 2 && armyOf(playerId) >= armyOf(owner) * 1.2);

  // Атака с перевесом. Несколько армий идут в одну провинцию вместе.
  for (const t of targetsOf()) {
    if (!canMove()) break;
    const owner = cells[t.cell].owner;
    if (!mayFight(owner)) continue;
    const avail = (n: CellId) => free(n, t.cell);
    const sources = armyCells()
      .filter((n) => avail(n) > 0 && reach(n).get(t.cell)?.kind === 'attack')
      .sort((a, b) => avail(b) - avail(a));
    const total = sources.reduce((sum, n) => sum + avail(n), 0);
    const need = t.defense > 0 ? Math.floor(t.defense * D.attackRatio) + 1 : 1;
    if (total < need) continue;
    // Берём с запасом, чтобы новой провинции было чем защищаться.
    let want = Math.min(total, Math.max(need, Math.ceil(need * 1.3)));
    const sent: [CellId, number][] = [];
    for (const src of sources) {
      if (want <= 0 || budget.ap < CONFIG.move.ap * (sent.length + 1) - 1e-9) break;
      const n = Math.min(avail(src), want);
      if (n <= 0) continue;
      sent.push([src, n]);
      want -= n;
    }
    // Не хватило ОД собрать нужную армию — не атакуем вполсилы.
    if (sent.reduce((sum, [, n]) => sum + n, 0) < need) continue;
    for (const [src, n] of sent) order(src, t.cell, n);
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
    order(id, best, n);
  }

  // Страховка: отбрасываем всё, что движок счёл бы невозможным.
  const orders: PlayerOrders = { tax, actions, moves, wars: [...wars] };
  const check = simulatePlan(state, playerId, orders);
  return {
    tax,
    actions: actions.filter((_, i) => check.actionErrors[i] === null),
    moves: moves.filter((_, i) => check.moveErrors[i] === null),
    wars: orders.wars!.filter((_, i) => check.warErrors[i] === null),
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
