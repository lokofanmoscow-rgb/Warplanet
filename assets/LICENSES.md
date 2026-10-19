# Источники и лицензии ассетов

Ассеты Age of Conquest и других игр не используются. Каждый новый файл в `assets/` записывается сюда: откуда взят и под какой лицензией.

| Файл | Источник | Лицензия |
|---|---|---|
| `fonts/PTSans-Regular.ttf`, `fonts/PTSans-Bold.ttf` | PT Sans, ParaType, через Google Fonts (`@expo-google-fonts/pt-sans`) | SIL Open Font License 1.1 (`fonts/OFL.txt`) |
| `fonts/PTSerif-Regular.ttf`, `fonts/PTSerif-Bold.ttf` | PT Serif, ParaType, через Google Fonts (`@expo-google-fonts/pt-serif`) | SIL Open Font License 1.1 |
| `maps/*.json` (Европа, Африка, США, Россия, мир) | Собраны скриптом `tools/maps/build.mjs` из Natural Earth 1:10m (admin 1, admin 0, populated places, lakes, marine polys) | Natural Earth — общественное достояние |
| `sounds/*.wav`, `sounds/music.mp3` | Синтезированы скриптом `tools/gen-sounds.mjs` (`npm run sounds`), без чужих записей | Свои, можно использовать свободно |
| `icon.png`, `android-icon-*.png`, `splash-icon.png`, `favicon.png` | Нарисованы для проекта (SVG → PNG) | Свои, можно использовать свободно |
| Спрайты городов, армий и флотов, декора, иконки интерфейса | Рисуются кодом (`src/ui/map/sprites.tsx`, `src/ui/map/units.tsx`, `src/ui/icons.tsx`) | Свои |

## Как заменить заглушки на картинки

Положите PNG с прозрачным фоном (в двойном размере) в нужную папку и выполните `npm run assets` — код править не нужно.

`assets/sprites/`:

| Имя | Размер | Что это |
|---|---|---|
| `city_small.png`, `city_medium.png`, `city_large.png` | 128×128 | Город по населению (до 15 000, до 30 000, больше) |
| `capital.png` | 128×128 | Столица, крупнее города, с флагштоком |
| `fort.png` | 128×128 | Стены укрепления поверх города |
| `decor_1.png` … `decor_6.png` | 64×64 | Декор суши: 1–2 лиственные деревья, 3 ель, 4 пальма, 5 гора, 6 холм |

Солдатики и корабли рисуются только кодом (`src/ui/map/units.tsx`): там у каждого цвета страны своя форма и флаг.

`assets/ui/`: иконки 48×48 — `icon_gold.png`, `icon_ap.png`, `icon_happiness.png`, `icon_tax.png` (а также `icon_<имя>.png` для любой иконки из `src/ui/icons.tsx`).

Где брать: Kenney.nl (CC0), OpenGameArt, генерация (Kandinsky, Шедеврум, Stable Diffusion) по шаблону
«изометрический игровой ассет, {объект}, мультяшный средневековый стиль, тёплые цвета, свет слева сверху, чёткий контур, прозрачный фон, по центру».
