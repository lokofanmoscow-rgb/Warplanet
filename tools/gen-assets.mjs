#!/usr/bin/env node
// Реестр картинок: находит PNG в assets/sprites и assets/ui и пишет src/ui/assets.generated.ts.
// Пока файла нет, игра рисует простую фигуру-заглушку. Положили PNG с нужным именем —
// запустите `npm run assets` (или любую установку зависимостей), код править не нужно.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = { sprites: 'assets/sprites', ui: 'assets/ui', map: 'assets/map' };
let out = '// Создаётся tools/gen-assets.mjs — не править руками.\n\n';
for (const [name, dir] of Object.entries(dirs)) {
  const abs = path.join(root, dir);
  const files = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => f.endsWith('.png')).sort() : [];
  out += `export const ${name.toUpperCase()}: Record<string, number> = {\n`;
  for (const f of files) out += `  ${JSON.stringify(f.replace(/\.png$/, ''))}: require('../../${dir}/${f}'),\n`;
  out += '};\n\n';
}
fs.writeFileSync(path.join(root, 'src/ui/assets.generated.ts'), out.trimEnd() + '\n');
console.log('src/ui/assets.generated.ts обновлён');
