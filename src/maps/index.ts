import { registerMap, getMap, type MapDef } from '../engine';
import africa from '../../assets/maps/africa.json';
import europe from '../../assets/maps/europe.json';

// Все карты собираются скриптом tools/maps/build.mjs в assets/maps/.
export const MAPS: MapDef[] = [europe as unknown as MapDef, africa as unknown as MapDef];

for (const map of MAPS) registerMap(map);

export const DEFAULT_MAP_ID = 'europe';

export { getMap };
