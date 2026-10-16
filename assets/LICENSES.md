# Источники и лицензии ассетов

Ассеты Age of Conquest и других игр не используются. Каждый новый файл в `assets/` записывается сюда: откуда взят и под какой лицензией.

| Файл | Источник | Лицензия |
|---|---|---|
| `fonts/PTSans-Regular.ttf`, `fonts/PTSans-Bold.ttf` | PT Sans, ParaType, через Google Fonts (`@expo-google-fonts/pt-sans`) | SIL Open Font License 1.1 (`fonts/OFL.txt`) |
| `fonts/PTSerif-Regular.ttf`, `fonts/PTSerif-Bold.ttf` | PT Serif, ParaType, через Google Fonts (`@expo-google-fonts/pt-serif`) | SIL Open Font License 1.1 |
| `maps/europe.json` | Собран скриптом `tools/maps/build.mjs` из Natural Earth 1:10m (admin 1, admin 0, populated places) | Natural Earth — общественное достояние |
| `icon.png`, `android-icon-*.png`, `splash-icon.png`, `favicon.png` | Нарисованы для проекта (SVG → PNG) | Свои, можно использовать свободно |
| Спрайты городов, армий, декора, иконки интерфейса | Пока рисуются кодом (заглушки в `src/ui/map/sprites.tsx`, `src/ui/icons.tsx`) | Свои |

## Как заменить заглушки на картинки

Положите PNG с прозрачным фоном (в двойном размере) в нужную папку и выполните `npm run assets` — код править не нужно.

`assets/sprites/`:

| Имя | Размер | Что это |
|---|---|---|
| `city_small.png`, `city_medium.png`, `city_large.png` | 128×128 | Город по населению (до 15 000, до 30 000, больше) |
| `capital.png` | 128×128 | Столица, крупнее города, с флагштоком |
| `fort.png` | 128×128 | Стены укрепления поверх города |
| `army.png` | 96×96 | Солдат, одежда серая — тонируется кодом в цвет игрока |
| `ship.png` | 96×96 | Корабль вместо армии в море, тоже тонируется |
| `decor_1.png` … `decor_6.png` | 64×64 | Декор суши: 1–2 лиственные деревья, 3 ель, 4 пальма, 5 гора, 6 холм |

`assets/ui/`: иконки 48×48 — `icon_gold.png`, `icon_ap.png`, `icon_happiness.png`, `icon_tax.png` (а также `icon_<имя>.png` для любой иконки из `src/ui/icons.tsx`).

Где брать: Kenney.nl (CC0), OpenGameArt, генерация (Kandinsky, Шедеврум, Stable Diffusion) по шаблону
«изометрический игровой ассет, {объект}, мультяшный средневековый стиль, тёплые цвета, свет слева сверху, чёткий контур, прозрачный фон, по центру».
