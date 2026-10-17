#!/usr/bin/env node
// Сборка карты из Natural Earth: node tools/maps/build.mjs europe
// Результат — assets/maps/<id>.json (провинции, морские зоны, соседи, население, стартовые точки)
// и картинка для проверки tools/maps/out/<id>.svg.
//
// Шаги (как в ТЗ):
//  1. Регионы 1-го уровня Natural Earth для стран из настроек, обрезанные рамкой.
//  2. Регионы сливаются в провинции примерно равной площади, в пределах страны.
//  3. Море делится на зоны диаграммой Вороного, обрезанной по побережью.
//  4. Контуры упрощаются mapshaper до нескольких десятков точек, мелкие острова отбрасываются.
//  5. Соседство — по общим границам, проливы задаются вручную.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoAzimuthalEqualArea, geoConicConformal } from 'd3-geo';
import { Delaunay } from 'd3-delaunay';
import mapshaper from 'mapshaper';
import polylabel from 'polylabel';
import { ensureData, shp } from './lib/data.mjs';
import {
  bboxOf,
  geometryArea,
  kmBetween,
  mainCentroid,
  minVertexKm,
  pointInGeometry,
  polygons,
  rings,
  sharedVertexAdjacency,
} from './lib/geo.mjs';
import { partition } from './lib/partition.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const mapId = process.argv[2] ?? 'europe';
const cfg = (await import(`./configs/${mapId}.mjs`)).default;
const log = (...a) => console.log(...a);

await ensureData();

// ---------- mapshaper ----------

async function ms(commands, input = {}) {
  const files = {};
  for (const [k, v] of Object.entries(input)) files[k] = typeof v === 'string' ? v : JSON.stringify(v);
  const out = await mapshaper.applyCommands(commands, files);
  const result = {};
  for (const [k, v] of Object.entries(out)) result[k.replace(/\.json$/, '')] = JSON.parse(v);
  return result;
}

const q = (s) => JSON.stringify(s);
const wl = q(cfg.countries);
const mergeExpr = `adm0_a3 = (${q(cfg.merge)})[adm0_a3] || adm0_a3`;

// ---------- 1. Играбельные регионы (долгота/широта) ----------

log('1. Регионы…');
// Озёра, которые в Natural Earth входят в регионы (Великие озёра в штатах США), вырезаются — там вода.
const lakes = cfg.eraseLakes?.length
  ? (await ms(
      `-i ${shp('ne_10m_lakes')} name=lakes -filter ${q(`${q(cfg.eraseLakes)}.indexOf(name) > -1`)} -o format=geojson lakes.json`,
    )).lakes
  : null;
if (lakes) log(`   вырезаю озёра: ${lakes.features.length}`);

// Регионы стран из списка, обрезанные рамкой clip (bbox=… или файлом с контуром).
async function loadPlay(list, clip, files = {}) {
  const { play } = await ms(
    `-i ${shp('ne_10m_admin_1_states_provinces')} name=play ` +
      `-each ${q(mergeExpr)} ` +
      `-filter ${q(`${q(list)}.indexOf(adm0_a3) > -1`)} ` +
      `-clip ${clip} ` +
      (lakes ? '-erase lakes.json ' : '') +
      `-filter-islands min-area=${cfg.minIslandKm2}km2 remove-empty ` +
      `-filter-fields adm0_a3,name,name_ru ` +
      `-o format=geojson precision=0.000001 play.json`,
    lakes ? { ...files, 'lakes.json': lakes } : files,
  );
  return play.features.filter((f) => f.geometry && geometryArea(f.geometry) > 0);
}

// Сначала регионы в прямоугольнике долгот и широт bbox — по ним считаются проекция и размер карты.
// Затем играбельной становится вся суша этих стран внутри прямоугольника карты: без косого
// среза по меридиану и серой «ничейной» земли у края.
const preRegions = await loadPlay(cfg.frameCountries ?? cfg.countries, `bbox=${cfg.bbox.join(',')}`);

// Коническая подходит для средних широт (Европа); у экватора — азимутальная равновеликая.
const projection = (
  cfg.projection.type === 'azimuthalEqualArea'
    ? geoAzimuthalEqualArea()
    : geoConicConformal().parallels(cfg.projection.parallels)
)
  .rotate(cfg.projection.rotate)
  .scale(1000)
  .translate([0, 0]);
{
  // Рамка = границы суши в bbox + поля.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of preRegions) for (const ring of rings(r.geometry)) for (const p of ring) {
    const [x, y] = projection(p);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const k = cfg.width / (x1 - x0);
  projection.scale(1000 * k).translate([-x0 * k, -y0 * k]);
  const kmPerUnit = kmBetween(projection.invert([cfg.width / 2, (y1 - y0) * k / 2]), projection.invert([cfg.width / 2 + 100, (y1 - y0) * k / 2])) / 100;
  const m = cfg.marginKm / kmPerUnit;
  const k2 = cfg.width / (cfg.width + 2 * m);
  projection.scale(1000 * k * k2).translate([(-x0 * k + m) * k2, (-y0 * k + m) * k2]);
  cfg.height = Math.ceil(((y1 - y0) * k + 2 * m) * k2);
}
const W = cfg.width;
const H = cfg.height;
log(`   размер карты: ${W}×${H}`);
const inFrame = (lonlat) => {
  const [x, y] = projection(lonlat);
  return x >= 0 && x <= W && y >= 0 && y <= H;
};

const frameLonLat = [];
const STEPS = 64;
for (let i = 0; i <= STEPS; i++) frameLonLat.push(projection.invert([(W * i) / STEPS, 0]));
for (let i = 1; i <= STEPS; i++) frameLonLat.push(projection.invert([W, (H * i) / STEPS]));
for (let i = 1; i <= STEPS; i++) frameLonLat.push(projection.invert([W - (W * i) / STEPS, H]));
for (let i = 1; i <= STEPS; i++) frameLonLat.push(projection.invert([0, H - (H * i) / STEPS]));
const frame = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [frameLonLat.reverse()] } }] };

for (const [t, xy] of [['СЗ', [0, 0]], ['С', [W / 2, 0]], ['СВ', [W, 0]], ['З', [0, H / 2]], ['В', [W, H / 2]], ['ЮЗ', [0, H]], ['Ю', [W / 2, H]], ['ЮВ', [W, H]]]) log(`   угол ${t}: ${projection.invert(xy).map((v) => v.toFixed(1)).join(', ')}`);
const regions = await loadPlay(cfg.countries, 'frame.json', { 'frame.json': frame });
log(`   регионов: ${regions.length}`);

// Площадь в км² (геодезически приблизительно).
function areaKm2(geometry) {
  let s = 0;
  for (const poly of polygons(geometry)) {
    poly.forEach((ring, k) => {
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j];
        const [x2, y2] = ring[i];
        a += ((x2 - x1) * Math.PI) / 180 * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
      }
      a = Math.abs((a * 6378.137 * 6378.137) / 2);
      s += k === 0 ? a : -a;
    });
  }
  return s;
}

for (const r of regions) {
  r.area = areaKm2(r.geometry);
  const c = mainCentroid(r.geometry);
  r.lonlat = c;
}

// Регионы, переданные другой стране (анклавы и отрезанные куски): точка внутри региона → код страны.
for (const rc of cfg.regionCountry ?? []) {
  const hit = regions.filter((r) => pointInGeometry(rc.at, r.geometry));
  for (const r of hit) r.properties.adm0_a3 = rc.to;
  if (!hit.length) log(`   ! ${rc.name}: регион не найден`);
}

// Отдельные провинции из настроек: регион выделяется в собственную «страну» из одной провинции.
for (const [k, sep] of (cfg.separate ?? []).entries()) {
  const hit = regions.filter((r) => pointInGeometry(sep.at, r.geometry));
  for (const r of hit) {
    r.properties.realA3 = r.properties.adm0_a3;
    r.properties.adm0_a3 = `SEP${k}`;
    r.separateName = sep.name;
  }
  if (!hit.length) log(`   ! ${sep.name}: регион не найден`);
}
const separateCodes = (cfg.separate ?? []).map((_, k) => `SEP${k}`);

// ---------- Население стран в рамке ----------

const { countries: admin0 } = await ms(
  `-i ${shp('ne_10m_admin_0_countries')} name=countries -filter-fields ADM0_A3,POP_EST,NAME_RU -drop geometry -o format=json countries.json`,
);
const { places } = await ms(
  `-i ${shp('ne_10m_populated_places')} name=places -filter-fields NAME,NAME_RU,ADM0_A3,POP_MAX,FEATURECLA,ADM0CAP -o format=geojson places.json`,
);
const allPlaces = places.features.map((f) => ({
  ...f.properties,
  ORIG_A3: f.properties.ADM0_A3,
  ADM0_A3: cfg.merge[f.properties.ADM0_A3] ?? f.properties.ADM0_A3,
  at: f.geometry.coordinates,
}));

// Русское название страны (короткое из настроек, если задано).
const countryName = (code) => cfg.countryNames?.[code] ?? admin0.find((c) => c.ADM0_A3 === code)?.NAME_RU ?? code;

const country = {};
for (const code of [...cfg.countries, ...separateCodes]) {
  const regs = regions.filter((r) => r.properties.adm0_a3 === code);
  const area = regs.reduce((s, r) => s + r.area, 0);
  if (code.startsWith('SEP')) {
    // Население отдельной провинции — по плотности страны, из которой она выделена.
    const parent = country[regs[0]?.properties.realA3];
    country[code] = { code, regions: regs, area, pop: parent ? (parent.pop * area) / (parent.area + area) : 0 };
    continue;
  }
  const popEst = admin0
    .filter((c) => (cfg.merge[c.ADM0_A3] ?? c.ADM0_A3) === code)
    .reduce((s, c) => s + Math.max(0, c.POP_EST), 0);
  const pl = allPlaces.filter((p) => p.ADM0_A3 === code);
  const cityAll = pl.reduce((s, p) => s + p.POP_MAX, 0);
  const cityIn = pl.filter((p) => inFrame(p.at)).reduce((s, p) => s + p.POP_MAX, 0);
  country[code] = { code, regions: regs, area, pop: popEst * (cityAll > 0 ? cityIn / cityAll : 1) };
}

// ---------- 2. Провинции ----------

log('2. Провинции…');
// onePerCountry: каждая страна — одна провинция целиком (с островами), без разбиения.
// onePerRegion: каждый регион 1-го уровня (штат) — своя провинция; regionMerge присоединяет мелкие к соседу.
const splitCountries = !cfg.onePerCountry && !cfg.onePerRegion;
// Компоненты связности каждой страны: общие границы + узкие проливы.
for (const c of splitCountries ? Object.values(country) : []) {
  const regs = c.regions;
  const adj = sharedVertexAdjacency(regs.map((r) => r.geometry));
  const comp = new Array(regs.length).fill(-1);
  let nc = 0;
  for (let i = 0; i < regs.length; i++) {
    if (comp[i] !== -1) continue;
    const stack = [i];
    comp[i] = nc;
    while (stack.length) {
      const cur = stack.pop();
      for (const nb of adj[cur]) if (comp[nb] === -1) { comp[nb] = nc; stack.push(nb); }
    }
    nc++;
  }
  // Связываем близкие компоненты (проливы уже нескольких десятков км).
  const nComp = nc;
  const parent = [...Array(nComp).keys()];
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const members = Array.from({ length: nComp }, (_, k) => regs.map((r, i) => i).filter((i) => comp[i] === k));
  const pairs = [];
  for (let x = 0; x < nComp; x++) for (let y = x + 1; y < nComp; y++) {
    let best = Infinity, pa = -1, pb = -1;
    for (const i of members[x]) for (const j of members[y]) {
      if (kmBetween(regs[i].lonlat, regs[j].lonlat) > 400) continue;
      const d = minVertexKm(regs[i].geometry, regs[j].geometry, 300);
      if (d < best) { best = d; pa = i; pb = j; }
    }
    if (best < cfg.linkKm) pairs.push([best, x, y, pa, pb]);
  }
  pairs.sort((u, v) => u[0] - v[0]);
  for (const [, x, y, pa, pb] of pairs) {
    if (find(x) === find(y)) continue;
    parent[find(y)] = find(x);
    adj[pa].add(pb);
    adj[pb].add(pa);
  }
  for (let i = 0; i < regs.length; i++) comp[i] = find(comp[i]);
  c.adj = adj;
  const compIds = [...new Set(comp)];
  c.components = compIds.map((id) => {
    const idx = regs.map((r, i) => i).filter((i) => comp[i] === id);
    return { idx, area: idx.reduce((s, i) => s + regs[i].area, 0) };
  }).sort((a, b) => b.area - a.area);
}

// Расстояния между компонентами страны (кэш для подбора числа провинций).
const compDistCache = new Map();
function compDist(c, a, b) {
  const key = `${c.code}:${c.components.indexOf(a)}:${c.components.indexOf(b)}`;
  if (!compDistCache.has(key)) {
    let best = Infinity;
    for (const i of a.idx) for (const j of b.idx) {
      if (kmBetween(c.regions[i].lonlat, c.regions[j].lonlat) > best + 600) continue;
      best = Math.min(best, minVertexKm(c.regions[i].geometry, c.regions[j].geometry, 200));
    }
    compDistCache.set(key, best);
  }
  return compDistCache.get(key);
}

// Раздача провинций странам: вес = площадь^a × население^p.
function allocate(unit) {
  let total = 0;
  for (const c of Object.values(country)) {
    const w = Math.pow(c.area, cfg.areaExponent) * Math.pow(Math.max(c.pop, 1), cfg.popExponent);
    let k = Math.max(1, Math.round(w / unit));
    const T = c.area / k;
    const main = [];
    const far = [];
    const near = [];
    c.components.forEach((comp, ci) => {
      if (ci === 0 || comp.area >= 0.3 * T) return main.push(comp);
      const dmin = Math.min(...c.components.filter((o) => o !== comp && (o === c.components[0] || o.area >= 0.3 * T))
        .map((o) => compDist(c, o, comp)));
      if (dmin > cfg.farKm && comp.area >= cfg.minFarKm2) far.push(comp);
      else near.push(comp);
    });
    k = Math.max(k, main.length);
    c.k = k;
    c.main = main;
    c.far = far;
    c.near = near;
    total += k + far.length;
  }
  return total;
}
let lo = 1, hi = 1e9, unit = 1;
if (splitCountries) {
  for (let it = 0; it < 60; it++) {
    unit = Math.sqrt(lo * hi);
    if (allocate(unit) > cfg.targetProvinces) lo = unit; else hi = unit;
  }
  log(`   провинций суши: ${allocate(hi)}`);
}

// Разбиение компонент на группы.
let provCount = 0;
const provOfRegion = new Map();
if (cfg.onePerCountry) {
  for (const c of Object.values(country)) {
    if (!c.regions.length) continue;
    for (const r of c.regions) provOfRegion.set(r, provCount);
    provCount++;
  }
}
if (cfg.onePerRegion) {
  const byKey = new Map();
  for (const r of regions) {
    const key = cfg.regionMerge?.[r.properties.name] ?? r.properties.name;
    if (!byKey.has(key)) byKey.set(key, provCount++);
    provOfRegion.set(r, byKey.get(key));
  }
}
for (const c of splitCountries ? Object.values(country) : []) {
  const lat0 = (c.regions.reduce((s, r) => s + r.lonlat[1], 0) / Math.max(1, c.regions.length)) * Math.PI / 180;
  const node = (r) => ({ area: r.area, x: r.lonlat[0] * Math.cos(lat0) * 111.32, y: r.lonlat[1] * 110.57 });
  // Число групп по компонентам — пропорционально площади, минимум одна.
  const mainArea = c.main.reduce((s, m) => s + m.area, 0);
  const shares = c.main.map((m) => Math.max(1, Math.floor((m.area / mainArea) * c.k)));
  let rest = c.k - shares.reduce((s, x) => s + x, 0);
  const order = c.main.map((m, i) => i).sort((a, b) => (c.main[b].area / mainArea) * c.k - shares[b] - ((c.main[a].area / mainArea) * c.k - shares[a]));
  for (let i = 0; rest > 0; i = (i + 1) % order.length, rest--) shares[order[i]]++;

  c.main.forEach((comp, ci) => {
    const nodes = comp.idx.map((i) => node(c.regions[i]));
    const local = comp.idx.map((i) => new Set([...c.adj[i]].map((j) => comp.idx.indexOf(j)).filter((j) => j >= 0)));
    const groups = partition(nodes, local, shares[ci]);
    const base = provCount;
    comp.idx.forEach((i, k) => provOfRegion.set(c.regions[i], base + groups[k]));
    provCount += Math.max(...groups) + 1;
  });
  for (const comp of c.far) {
    for (const i of comp.idx) provOfRegion.set(c.regions[i], provCount);
    provCount++;
  }
  for (const comp of c.near) {
    // Мелкие острова рядом — к ближайшей провинции этой страны.
    let best = null, bestD = Infinity;
    for (const i of comp.idx) for (const r of c.regions) {
      if (!provOfRegion.has(r) || comp.idx.includes(c.regions.indexOf(r))) continue;
      const d = kmBetween(c.regions[i].lonlat, r.lonlat);
      if (d < bestD) { bestD = d; best = r; }
    }
    for (const i of comp.idx) provOfRegion.set(c.regions[i], provOfRegion.get(best));
  }
}
log(`   групп: ${provCount}`);

// ---------- Фон: суша вне игры ----------

log('   фоновая суша…');
// Страны не из списка; убранные (dropBackground) — просто море.
const hidden = q([...cfg.countries, ...(cfg.dropBackground ?? [])]);
// background: false — вокруг только вода, чужой суши нет вовсе.
const { bg } = cfg.background === false ? { bg: null } : await ms(
  `-i ${shp('ne_10m_admin_1_states_provinces')} name=bg ` +
    `-each ${q(mergeExpr)} ` +
    `-filter ${q(`${hidden}.indexOf(adm0_a3) == -1`)} ` +
    `-clip frame.json ` +
    `-filter-islands min-area=${cfg.minIslandKm2}km2 remove-empty ` +
    `-o format=geojson precision=0.000001 bg.json`,
  { 'frame.json': frame },
);

// ---------- Перевод в плоские координаты ----------

const projGeom = (g) => {
  const pr = (ring) => ring.map((p) => projection(p));
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: g.coordinates.map(pr) };
  return { type: 'MultiPolygon', coordinates: g.coordinates.map((poly) => poly.map(pr)) };
};
const planarRegions = {
  type: 'FeatureCollection',
  features: regions.map((r) => ({
    type: 'Feature',
    properties: { prov: provOfRegion.get(r), adm0: r.properties.adm0_a3 },
    geometry: projGeom(r.geometry),
  })),
};
const planarBg = {
  type: 'FeatureCollection',
  features: (bg?.features ?? []).filter((f) => f.geometry).map((f) => ({ type: 'Feature', properties: { bg: 1 }, geometry: projGeom(f.geometry) })),
};
log(`   фоновых регионов: ${planarBg.features.length}`);

// ---------- 3. Морские зоны ----------

log('3. Морские зоны…');
// Затравка может стоять чуть за краем карты — её зона всё равно заходит на карту. Далёкие не нужны.
const nearFrame = (lonlat) => {
  const [x, y] = projection(lonlat);
  return x >= -0.2 * W && x <= 1.2 * W && y >= -0.2 * H && y <= 1.2 * H;
};
for (const s of cfg.seas) if (!nearFrame(s.at)) log(`   ! ${s.name}: далеко за краем карты, пропускаю`);
cfg.seas = cfg.seas.filter((s) => nearFrame(s.at));
const seeds = cfg.seas.map((s) => projection(s.at));
const voronoi = Delaunay.from(seeds).voronoi([0, 0, W, H]);
const cells = {
  type: 'FeatureCollection',
  features: seeds
    .map((_, i) => ({ type: 'Feature', properties: { zone: i }, geometry: { type: 'Polygon', coordinates: [voronoi.cellPolygon(i)] } }))
    .filter((f) => f.geometry.coordinates[0]),
};
const stage = await ms(
  `-i regions.json bg.json cells.json combine-files ` +
    `-dissolve target=regions prov copy-fields=adm0 name=provinces ` +
    `-dissolve target=bg name=bgland ` +
    `-dissolve target=provinces + name=landp ` +
    `-dissolve target=bgland + name=landb ` +
    `-merge-layers target=landp,landb name=landmask force ` +
    `-dissolve target=landmask ` +
    `-erase target=cells landmask ` +
    `-explode target=cells ` +
    `-o target=provinces,bgland,cells format=geojson`,
  { 'regions.json': planarRegions, 'bg.json': planarBg, 'cells.json': cells },
);

// Части зон без затравки (Вороной не знает про сушу) уходят к соседней зоне по общей границе.
const parts = stage.cells.features.filter((f) => f.geometry && geometryArea(f.geometry) > 1);
for (const p of parts) {
  p.zone = p.properties.zone;
  p.area = geometryArea(p.geometry);
  p.main = pointInGeometry(seeds[p.zone], p.geometry);
}
for (const z of cfg.seas.keys()) {
  const own = parts.filter((p) => p.zone === z);
  if (own.length && !own.some((p) => p.main)) own.sort((a, b) => b.area - a.area)[0].main = true;
}
const partAdj = sharedVertexAdjacency(parts.map((p) => p.geometry), 3);
for (let pass = 0; pass < 10; pass++) {
  let changed = false;
  parts.forEach((p, i) => {
    if (p.main || p.fixed) return;
    const nb = [...partAdj[i]].map((j) => parts[j]).filter((o) => o.zone !== p.properties.zone && (o.main || o.fixed));
    if (!nb.length) return;
    nb.sort((a, b) => b.area - a.area);
    p.zone = nb[0].zone;
    p.fixed = true;
    changed = true;
  });
  if (!changed) break;
}
const seaParts = {
  type: 'FeatureCollection',
  // Озёра и закрытые заливы без связи с зоной — отбрасываются (под ними рисуется вода).
  features: parts.filter((p) => p.main || p.fixed).map((p) => ({ type: 'Feature', properties: { zone: p.zone }, geometry: p.geometry })),
};

// ---------- 4. Упрощение общей топологии ----------

log('4. Упрощение…');
const final = await ms(
  `-i provinces.json bgland.json sea.json combine-files ` +
    `-dissolve target=sea zone name=seas ` +
    `-simplify target=* ${cfg.simplify ?? 'interval=4'} keep-shapes ` +
    `-filter-slivers target=* min-area=30 ` +
    `-o target=provinces,bgland,seas format=geojson precision=0.01`,
  { 'provinces.json': stage.provinces, 'bgland.json': stage.bgland, 'sea.json': seaParts },
);

// ---------- 5. Клетки, соседство, имена, население ----------

log('5. Соседство и данные…');
const provFeatures = final.provinces.features.filter((f) => f.geometry).sort((a, b) => a.properties.prov - b.properties.prov);
const seaFeatures = final.seas.features.filter((f) => f.geometry).sort((a, b) => a.properties.zone - b.properties.zone);
const all = [
  ...provFeatures.map((f) => ({ kind: 'land', f })),
  ...seaFeatures.map((f) => ({ kind: 'sea', f })),
];
const adj = sharedVertexAdjacency(all.map((c) => c.f.geometry), 2);

const cellAt = (lonlat) => {
  const p = projection(lonlat);
  const i = all.findIndex((c) => pointInGeometry(p, c.f.geometry));
  return i;
};
const linkCells = (a, b, what) => {
  if (a < 0 || b < 0) return log(`   ! ${what}: точка вне клеток`);
  if (a === b) return;
  adj[a].add(b);
  adj[b].add(a);
};
for (const s of cfg.straits) linkCells(cellAt(s.a), cellAt(s.b), s.name);
const straits = cfg.straits.map((s) => [cellAt(s.a), cellAt(s.b)]).filter(([a, b]) => a >= 0 && b >= 0 && a !== b);
const seaIndex = (name) => {
  const z = cfg.seas.findIndex((s) => s.name === name);
  return all.findIndex((c) => c.kind === 'sea' && c.f.properties.zone === z);
};
for (const [a, b] of cfg.seaLinks) linkCells(seaIndex(a), seaIndex(b), `${a} — ${b}`);

// Население: доля страны по площади и по городам пополам.
const placesPlanar = allPlaces.filter((p) => inFrame(p.at)).map((p) => ({ ...p, xy: projection(p.at) }));
const landCells = all.filter((c) => c.kind === 'land');
for (const c of landCells) {
  c.places = [];
  c.adm0 = c.f.properties.adm0;
  c.bb = bboxOf(c.f.geometry);
  const regs = regions.filter((r) => provOfRegion.get(r) === c.f.properties.prov);
  c.areaKm2 = regs.reduce((s, r) => s + r.area, 0);
  c.separateName = regs.find((r) => r.separateName)?.separateName;
}
// Город — в провинцию, где он стоит; прибрежный город, выпавший из упрощённого контура, — в ближайшую своей страны.
for (const p of placesPlanar) {
  let cell = landCells.find((c) => p.xy[0] >= c.bb[0] && p.xy[0] <= c.bb[2] && p.xy[1] >= c.bb[1] && p.xy[1] <= c.bb[3] && pointInGeometry(p.xy, c.f.geometry));
  if (!cell) {
    let best = Infinity;
    for (const c of landCells) {
      if (c.adm0 !== p.ADM0_A3) continue;
      for (const ring of rings(c.f.geometry)) for (const v of ring) {
        const d = Math.hypot(v[0] - p.xy[0], v[1] - p.xy[1]);
        if (d < best && d < 12) { best = d; cell = c; }
      }
    }
  }
  cell?.places.push(p);
}
for (const code of [...cfg.countries, ...separateCodes]) {
  const cs = landCells.filter((c) => c.adm0 === code);
  if (!cs.length) continue;
  const area = cs.reduce((s, c) => s + c.areaKm2, 0);
  const city = cs.reduce((s, c) => s + c.places.reduce((t, p) => t + p.POP_MAX, 0), 0);
  for (const c of cs) {
    const cityShare = city > 0 ? c.places.reduce((t, p) => t + p.POP_MAX, 0) / city : c.areaKm2 / area;
    c.realPop = country[code].pop * (0.5 * (c.areaKm2 / area) + 0.5 * cityShare);
  }
}
const pops = landCells.map((c) => c.realPop);
const pmin = Math.min(...pops), pmax = Math.max(...pops);
const [g0, g1] = cfg.popRange;
for (const c of landCells) {
  const t = Math.pow((c.realPop - pmin) / (pmax - pmin || 1), cfg.popGamma);
  c.pop = Math.round((g0 + (g1 - g0) * t) / 100) * 100;
}

// Имена: столица страны или крупнейший город провинции.
const used = new Set();
for (const c of landCells) {
  // Только города своей страны: точка на границе может попасть в соседний контур.
  const own = c.places.filter((p) => p.NAME_RU && p.ORIG_A3 === c.adm0);
  const cand = (own.length ? own : c.places.filter((p) => p.NAME_RU && p.ADM0_A3 === c.adm0))
    .sort((a, b) => (b.ADM0CAP ?? 0) - (a.ADM0CAP ?? 0) || b.POP_MAX - a.POP_MAX);
  const pick = cand.find((p) => !used.has(p.NAME_RU));
  if (c.separateName) {
    c.name = c.separateName;
  } else if (cfg.nameBy === 'country') {
    c.name = countryName(c.adm0);
  } else if (cfg.nameBy === 'region') {
    // Имя самого большого региона провинции (штата, к которому присоединены мелкие).
    const reg = regions.filter((r) => provOfRegion.get(r) === c.f.properties.prov).sort((a, b) => b.area - a.area)[0];
    c.name = reg?.properties.name_ru || reg?.properties.name || `Провинция ${c.f.properties.prov}`;
  } else if (pick) {
    c.name = pick.NAME_RU;
  } else {
    const reg = regions.filter((r) => provOfRegion.get(r) === c.f.properties.prov).sort((a, b) => b.area - a.area)[0];
    c.name = reg?.properties.name_ru || reg?.properties.name || `Провинция ${c.f.properties.prov}`;
  }
  c.name = cfg.rename?.[c.name] ?? c.name;
  used.add(c.name);
}

// Точка для иконок: полюс недоступности самого большого полигона.
function labelPoint(geometry) {
  let best = null, bestA = -1;
  for (const poly of polygons(geometry)) {
    const a = geometryArea({ type: 'Polygon', coordinates: poly });
    if (a > bestA) { bestA = a; best = poly; }
  }
  const p = polylabel(best, 1);
  return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
}

const flat = (ring) => {
  const out = [];
  // GeoJSON замыкает кольцо повтором первой точки — в игре это не нужно.
  for (let i = 0; i < ring.length - 1; i++) out.push(Math.round(ring[i][0] * 10) / 10, Math.round(ring[i][1] * 10) / 10);
  return out;
};

const outCells = all.map((c, id) => {
  const neighbors = [...adj[id]].sort((a, b) => a - b);
  const base = {
    id,
    name: c.kind === 'land' ? c.name : cfg.seas[c.f.properties.zone].name,
    kind: c.kind,
    neighbors,
    pop: c.kind === 'land' ? c.pop : 0,
    center: labelPoint(c.f.geometry),
    rings: rings(c.f.geometry).map(flat).filter((r) => r.length >= 6),
  };
  if (c.kind === 'land') {
    base.coastal = neighbors.some((n) => all[n].kind === 'sea');
    // На карте штатов страна одна — ИИ называются по своему штату, а не «США».
    base.country = c.adm0.startsWith('SEP') || cfg.onePerRegion ? undefined : c.adm0;
  }
  return base;
});

// Стартовые точки.
const startPoints = [];
for (const s of cfg.starts) {
  const id = cellAt(s.at);
  if (id < 0 || all[id].kind !== 'land') { log(`   ! старт ${s.name} не на суше`); continue; }
  if (startPoints.includes(id)) { log(`   ! старт ${s.name} в той же провинции`); continue; }
  startPoints.push(id);
}

// Проверки.
const landOut = outCells.filter((c) => c.kind === 'land');
const seaOut = outCells.filter((c) => c.kind === 'sea');
const isolated = outCells.filter((c) => c.neighbors.length === 0);
if (isolated.length) log(`   ! без соседей: ${isolated.map((c) => c.name).join(', ')}`);
for (let i = 0; i < startPoints.length; i++) for (let j = i + 1; j < startPoints.length; j++) {
  const a = outCells[startPoints[i]], b = outCells[startPoints[j]];
  if (a.neighbors.includes(b.id)) log(`   ! стартовые точки рядом: ${a.name} и ${b.name}`);
}
const pts = landOut.map((c) => c.rings.reduce((s, r) => s + r.length / 2, 0));
log(`   суша: ${landOut.length}, море: ${seaOut.length}, точек на провинцию: ${Math.round(pts.reduce((s, x) => s + x, 0) / pts.length)} (макс ${Math.max(...pts)})`);
log(`   население: ${Math.min(...landOut.map((c) => c.pop))}–${Math.max(...landOut.map((c) => c.pop))}`);

const result = {
  id: cfg.id,
  name: cfg.name,
  width: W,
  height: H,
  cells: outCells,
  startPoints,
  straits,
  // Русские названия стран — так называются ИИ-соперники по своей столице.
  countries: cfg.onePerRegion ? {} : Object.fromEntries(cfg.countries.map((code) => [code, countryName(code)])),
  decor: {
    mountains: (cfg.mountains ?? [])
      .map((p) => projection(p))
      .filter((p) => landCells.some((c) => pointInGeometry(p, c.f.geometry)))
      .map((p) => [Math.round(p[0]), Math.round(p[1])]),
  },
  background: (final.bgland.features ?? final.bgland.geometries.map((g) => ({ geometry: g })))
    .filter((f) => f.geometry)
    .flatMap((f) => rings(f.geometry).map(flat))
    .filter((r) => r.length >= 6),
  source: 'Natural Earth (public domain), tools/maps/build.mjs',
};

const outFile = path.join(root, 'assets', 'maps', `${cfg.id}.json`);
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result));
log(`Готово: ${path.relative(root, outFile)} (${Math.round(fs.statSync(outFile).size / 1024)} КБ)`);

// Картинка для проверки.
const svgDir = path.join(here, 'out');
fs.mkdirSync(svgDir, { recursive: true });
const palette = ['#C8423B', '#3D6FD1', '#4E9A51', '#8A5BB8', '#E08A2E', '#2AA6A0', '#D96BA8', '#CDB532', '#9c7b54', '#5c8f8a'];
const pathD = (rs) => rs.map((r) => 'M' + r.join(' ').replace(/(\S+) (\S+)/g, '$1,$2') + 'Z').join('');
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="sans-serif">`;
svg += `<rect width="${W}" height="${H}" fill="#1F4E79"/>`;
for (const c of seaOut) svg += `<path d="${pathD(c.rings)}" fill="${c.id % 2 ? '#2a5f8f' : '#3A7CA5'}" stroke="#163a5c" stroke-width="1" fill-rule="evenodd"/>`;
svg += `<path d="${pathD(result.background)}" fill="#8a8170" stroke="#3B2F2F" stroke-width="0.6" fill-rule="evenodd"/>`;
for (const c of landOut) svg += `<path d="${pathD(c.rings)}" fill="${startPoints.includes(c.id) ? '#ffffff' : palette[c.id % palette.length]}" fill-opacity="0.85" stroke="#3B2F2F" stroke-width="1.2" fill-rule="evenodd"/>`;
for (const c of outCells) for (const n of c.neighbors) if (n > c.id) {
  const b = outCells[n];
  svg += `<line x1="${c.center[0]}" y1="${c.center[1]}" x2="${b.center[0]}" y2="${b.center[1]}" stroke="${c.kind === 'sea' || b.kind === 'sea' ? '#9fd3ff' : '#222'}" stroke-width="0.8" opacity="0.6"/>`;
}
for (const c of outCells) svg += `<text x="${c.center[0]}" y="${c.center[1]}" font-size="${c.kind === 'sea' ? 13 : 11}" text-anchor="middle" fill="${c.kind === 'sea' ? '#d8ecff' : '#111'}">${c.name} ${c.kind === 'land' ? Math.round(c.pop / 1000) + 'k' : ''}</text>`;
svg += '</svg>';
fs.writeFileSync(path.join(svgDir, `${cfg.id}.svg`), svg);
log(`Проверка: ${path.relative(root, path.join(svgDir, `${cfg.id}.svg`))}`);
