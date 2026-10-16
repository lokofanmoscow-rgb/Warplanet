// Разбиение связного набора регионов на m смежных групп примерно равной площади.

/**
 * @param nodes [{ area, x, y }] — регионы (координаты в км)
 * @param adj   массив Set соседей (индексы nodes)
 * @param m     число групп
 * @returns     номер группы для каждого региона
 */
export function partition(nodes, adj, m) {
  const n = nodes.length;
  if (m <= 1 || n <= 1) return new Array(n).fill(0);
  m = Math.min(m, n);
  const total = nodes.reduce((s, r) => s + r.area, 0);
  const target = total / m;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Затравки: самые удалённые друг от друга регионы (начиная с края).
  const cx = nodes.reduce((s, r) => s + r.x * r.area, 0) / total;
  const cy = nodes.reduce((s, r) => s + r.y * r.area, 0) / total;
  const seeds = [];
  let first = 0;
  nodes.forEach((r, i) => {
    if (dist(r, { x: cx, y: cy }) > dist(nodes[first], { x: cx, y: cy })) first = i;
  });
  seeds.push(first);
  while (seeds.length < m) {
    let best = -1;
    let bestD = -1;
    nodes.forEach((r, i) => {
      if (seeds.includes(i)) return;
      const d = Math.min(...seeds.map((s) => dist(r, nodes[s])));
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    });
    seeds.push(best);
  }

  let group = runGrowth(nodes, adj, seeds, target);
  // Несколько итераций в духе k-means: затравка — регион у центра группы.
  for (let iter = 0; iter < 6; iter++) {
    const centers = groupCenters(nodes, group, m);
    const newSeeds = centers.map((c, g) => {
      let best = -1;
      let bestD = Infinity;
      nodes.forEach((r, i) => {
        if (group[i] !== g) return;
        const d = dist(r, c);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    });
    if (newSeeds.some((s) => s < 0)) break;
    group = runGrowth(nodes, adj, newSeeds, target);
  }
  return balance(nodes, adj, group, m, target);
}

function groupCenters(nodes, group, m) {
  const acc = Array.from({ length: m }, () => ({ x: 0, y: 0, a: 0 }));
  nodes.forEach((r, i) => {
    const g = acc[group[i]];
    g.x += r.x * r.area;
    g.y += r.y * r.area;
    g.a += r.area;
  });
  return acc.map((g) => ({ x: g.x / (g.a || 1), y: g.y / (g.a || 1) }));
}

/** Рост групп: на каждом шаге растёт самая маленькая группа, забирая ближайший к своей затравке регион. */
function runGrowth(nodes, adj, seeds, target) {
  const n = nodes.length;
  const m = seeds.length;
  const group = new Array(n).fill(-1);
  const area = new Array(m).fill(0);
  seeds.forEach((s, g) => {
    group[s] = g;
    area[g] = nodes[s].area;
  });
  let left = n - m;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  while (left > 0) {
    const order = [...Array(m).keys()].sort((a, b) => area[a] - area[b]);
    let grown = false;
    for (const g of order) {
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < n; i++) {
        if (group[i] !== g) continue;
        for (const j of adj[i]) {
          if (group[j] !== -1) continue;
          const score = dist(nodes[j], nodes[seeds[g]]);
          if (score < bestScore) {
            bestScore = score;
            best = j;
          }
        }
      }
      if (best >= 0) {
        group[best] = g;
        area[g] += nodes[best].area;
        left--;
        grown = true;
        break;
      }
    }
    if (!grown) {
      // Недостижимые регионы (не должно случаться в связном наборе) — к ближайшей группе.
      for (let i = 0; i < n; i++) {
        if (group[i] !== -1) continue;
        let best = 0;
        seeds.forEach((s, g) => {
          if (dist(nodes[i], nodes[s]) < dist(nodes[i], nodes[seeds[best]])) best = g;
        });
        group[i] = best;
        area[best] += nodes[i].area;
        left--;
      }
    }
  }
  void target;
  return group;
}

function connectedWithout(adj, group, g, removed) {
  const members = [];
  group.forEach((x, i) => {
    if (x === g && i !== removed) members.push(i);
  });
  if (members.length === 0) return false;
  const seen = new Set([members[0]]);
  const stack = [members[0]];
  while (stack.length) {
    const cur = stack.pop();
    for (const nb of adj[cur]) {
      if (nb === removed || group[nb] !== g || seen.has(nb)) continue;
      seen.add(nb);
      stack.push(nb);
    }
  }
  return seen.size === members.length;
}

/** Выравнивание: граничные регионы переходят из большой группы в меньшую соседнюю. */
function balance(nodes, adj, group, m, target) {
  const area = new Array(m).fill(0);
  nodes.forEach((r, i) => (area[group[i]] += r.area));
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    const order = [...nodes.keys()].sort((a, b) => area[group[b]] - area[group[a]]);
    for (const i of order) {
      const from = group[i];
      for (const j of adj[i]) {
        const to = group[j];
        if (to === from) continue;
        const before = Math.abs(area[from] - target) + Math.abs(area[to] - target);
        const after = Math.abs(area[from] - nodes[i].area - target) + Math.abs(area[to] + nodes[i].area - target);
        if (after >= before - target * 0.02) continue;
        if (!connectedWithout(adj, group, from, i)) continue;
        group[i] = to;
        area[from] -= nodes[i].area;
        area[to] += nodes[i].area;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return group;
}
