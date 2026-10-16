// Небольшие геометрические помощники без зависимостей.

/** Все кольца объекта GeoJSON: [[ [x, y], ... ], ...]. */
export function rings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

/** Полигоны: [[outer, ...holes], ...]. */
export function polygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export function vertexKey(p, digits = 6) {
  return `${p[0].toFixed(digits)},${p[1].toFixed(digits)}`;
}

export function vertexKeys(geometry, digits = 6) {
  const keys = new Set();
  for (const ring of rings(geometry)) for (const p of ring) keys.add(vertexKey(p, digits));
  return keys;
}

/** Соседство по общим вершинам: общая граница даёт хотя бы две общие вершины. */
export function sharedVertexAdjacency(geometries, digits = 6, minShared = 2) {
  const owners = new Map();
  geometries.forEach((g, i) => {
    for (const key of vertexKeys(g, digits)) {
      let list = owners.get(key);
      if (!list) owners.set(key, (list = []));
      list.push(i);
    }
  });
  const counts = new Map();
  for (const list of owners.values()) {
    if (list.length < 2) continue;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const key = list[a] < list[b] ? `${list[a]}|${list[b]}` : `${list[b]}|${list[a]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const adj = geometries.map(() => new Set());
  for (const [key, n] of counts) {
    if (n < minShared) continue;
    const [a, b] = key.split('|').map(Number);
    adj[a].add(b);
    adj[b].add(a);
  }
  return adj;
}

/** Площадь кольца на плоскости (по модулю). */
export function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(s / 2);
}

export function polygonArea(poly) {
  return ringArea(poly[0]) - poly.slice(1).reduce((s, h) => s + ringArea(h), 0);
}

export function geometryArea(geometry) {
  return polygons(geometry).reduce((s, p) => s + polygonArea(p), 0);
}

export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(pt, geometry) {
  return polygons(geometry).some((poly) => pointInRing(pt, poly[0]) && !poly.slice(1).some((h) => pointInRing(pt, h)));
}

export function bboxOf(geometry) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ring of rings(geometry)) {
    for (const [x, y] of ring) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

/** Приближённое расстояние в км между точками lon/lat. */
export function kmBetween(a, b) {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (a[0] - b[0]) * Math.cos(lat) * 111.32;
  const dy = (a[1] - b[1]) * 110.57;
  return Math.hypot(dx, dy);
}

/** Минимальное расстояние в км между вершинами двух геометрий (с прореживанием). */
export function minVertexKm(ga, gb, maxPoints = 1500) {
  const pa = sample(rings(ga).flat(), maxPoints);
  const pb = sample(rings(gb).flat(), maxPoints);
  let best = Infinity;
  for (const p of pa) for (const q of pb) {
    const d = kmBetween(p, q);
    if (d < best) best = d;
  }
  return best;
}

function sample(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[Math.floor(i)]);
  return out;
}

/** Центр масс самого большого полигона (для затравок и расстояний). */
export function mainCentroid(geometry) {
  let best = null;
  let bestArea = -1;
  for (const poly of polygons(geometry)) {
    const a = ringArea(poly[0]);
    if (a > bestArea) {
      bestArea = a;
      best = poly[0];
    }
  }
  if (!best) return [0, 0];
  let cx = 0, cy = 0, s = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const f = best[j][0] * best[i][1] - best[i][0] * best[j][1];
    cx += (best[j][0] + best[i][0]) * f;
    cy += (best[j][1] + best[i][1]) * f;
    s += f;
  }
  if (s === 0) return best[0];
  return [cx / (3 * s), cy / (3 * s)];
}
