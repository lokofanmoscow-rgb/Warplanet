import { registerMap, getMap, type MapDef } from '../engine';
import africa from '../../assets/maps/africa.json';
import europe from '../../assets/maps/europe.json';
import russia from '../../assets/maps/russia.json';
import usa from '../../assets/maps/usa.json';
import world from '../../assets/maps/world.json';

// Все карты собираются скриптом tools/maps/build.mjs в assets/maps/.
export const MAPS: MapDef[] = [europe, africa, usa, russia, world].map((m) => m as unknown as MapDef);

for (const map of MAPS) registerMap(map);

export const DEFAULT_MAP_ID = 'europe';

export { getMap };
