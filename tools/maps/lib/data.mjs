// Загрузка исходников Natural Earth (общественное достояние) в tools/maps/.cache.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = path.resolve(here, '..', '.cache');

const SOURCES = {
  ne_10m_admin_1_states_provinces: 'cultural',
  ne_10m_admin_0_countries: 'cultural',
  ne_10m_populated_places: 'cultural',
  // Озёра — чтобы вырезать Великие озёра из штатов США.
  ne_10m_lakes: 'physical',
  // Моря и заливы — названия морских зон на картах с autoSeas.
  ne_10m_geography_marine_polys: 'physical',
};

export function shp(name) {
  return path.join(CACHE, name, `${name}.shp`);
}

export async function ensureData() {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [name, kind] of Object.entries(SOURCES)) {
    if (fs.existsSync(shp(name))) continue;
    const url = `https://naciscdn.org/naturalearth/10m/${kind}/${name}.zip`;
    const zip = path.join(CACHE, `${name}.zip`);
    console.log(`Скачиваю ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Не удалось скачать ${url}: ${res.status}`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    fs.mkdirSync(path.join(CACHE, name), { recursive: true });
    execFileSync('unzip', ['-q', '-o', zip, '-d', path.join(CACHE, name)]);
  }
}
