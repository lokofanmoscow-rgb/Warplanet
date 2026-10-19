import React, { useEffect, useState } from 'react';
import { Image as RNImage, Platform } from 'react-native';
import { Canvas, Circle, Group, Path, Rect, RoundedRect, Skia, type SkPathBuilder } from '@shopify/react-native-skia';
import { UI } from './assets.generated';
import { renderImage } from './map/offscreen';
import { City } from './map/sprites';
import { SoldierGroup } from './map/units';
import { COLORS } from './theme';

// Иконки интерфейса 48×48: если в assets/ui лежит icon_<имя>.png — берётся он, иначе векторная заглушка.

export type IconName =
  | 'gold'
  | 'ap'
  | 'happiness'
  | 'tax'
  | 'turn'
  | 'recruit'
  | 'fortify'
  | 'buy'
  | 'loot'
  | 'move'
  | 'undo'
  | 'check'
  | 'menu'
  | 'log'
  | 'people'
  | 'flag'
  | 'crown'
  | 'wifi'
  | 'close'
  | 'swords'
  | 'city'
  | 'army'
  | 'sound'
  | 'music'
  | 'vibration';

const OUT = COLORS.border;
const NO_IMAGES = {};

function p(build: (path: SkPathBuilder) => void) {
  const b = Skia.PathBuilder.Make();
  build(b);
  return b.build();
}

function Glyph({ name, color }: { name: IconName; color: string }) {
  // Координаты в квадрате 0..24.
  switch (name) {
    case 'gold':
      return (
        <Group>
          <Circle cx={10} cy={14} r={7} color="#B8862A" />
          <Circle cx={13} cy={10} r={7} color={COLORS.gold} />
          <Circle cx={13} cy={10} r={7} color={OUT} style="stroke" strokeWidth={1.2} />
          <Circle cx={13} cy={10} r={4.2} color={COLORS.goldLight} style="stroke" strokeWidth={1.2} />
        </Group>
      );
    case 'ap':
      return (
        <Path
          path={p((q) => {
            q.moveTo(14, 2);
            q.lineTo(5, 14);
            q.lineTo(11, 14);
            q.lineTo(9, 22);
            q.lineTo(19, 9);
            q.lineTo(13, 9);
            q.close();
          })}
          color={color}
        />
      );
    case 'happiness':
      return (
        <Group>
          <Circle cx={12} cy={12} r={9} color={color} />
          <Circle cx={9} cy={10} r={1.4} color={OUT} />
          <Circle cx={15} cy={10} r={1.4} color={OUT} />
          <Path
            path={p((q) => {
              q.moveTo(7.5, 13.5);
              q.quadTo(12, 18.5, 16.5, 13.5);
            })}
            color={OUT}
            style="stroke"
            strokeWidth={1.6}
            strokeCap="round"
          />
        </Group>
      );
    case 'tax':
      return (
        <Group>
          <Rect x={11} y={4} width={2} height={15} color={color} />
          <Rect x={6} y={19} width={12} height={2} color={color} />
          <Rect x={4} y={6} width={16} height={1.6} color={color} />
          <Path path={p((q) => q.addArc({ x: 2, y: 6, width: 7, height: 7 }, 0, 180))} color={color} />
          <Path path={p((q) => q.addArc({ x: 15, y: 6, width: 7, height: 7 }, 0, 180))} color={color} />
        </Group>
      );
    case 'turn':
      return (
        <Group>
          <Path
            path={p((q) => {
              q.moveTo(6, 3);
              q.lineTo(18, 3);
              q.lineTo(12, 12);
              q.lineTo(18, 21);
              q.lineTo(6, 21);
              q.lineTo(12, 12);
              q.close();
            })}
            color={color}
            style="stroke"
            strokeWidth={1.8}
            strokeJoin="round"
          />
          <Path path={p((q) => { q.moveTo(8.5, 19.5); q.lineTo(15.5, 19.5); q.lineTo(12, 15); q.close(); })} color={color} />
        </Group>
      );
    case 'recruit':
      return (
        <Group>
          <Path path={p((q) => { q.addArc({ x: 5, y: 5, width: 14, height: 14 }, 180, 180); q.close(); })} color={color} />
          <Rect x={3} y={11.5} width={18} height={3} color={color} />
          <Circle cx={12} cy={5} r={1.8} color={color} />
          <Rect x={11} y={14} width={2} height={7} color={color} />
        </Group>
      );
    case 'fortify':
      return (
        <Path
          path={p((q) => {
            q.moveTo(3, 21);
            q.lineTo(3, 6);
            q.lineTo(7, 6);
            q.lineTo(7, 9);
            q.lineTo(10, 9);
            q.lineTo(10, 6);
            q.lineTo(14, 6);
            q.lineTo(14, 9);
            q.lineTo(17, 9);
            q.lineTo(17, 6);
            q.lineTo(21, 6);
            q.lineTo(21, 21);
            q.lineTo(14, 21);
            q.lineTo(14, 16);
            q.quadTo(12, 13, 10, 16);
            q.lineTo(10, 21);
            q.close();
          })}
          color={color}
        />
      );
    case 'buy':
      return (
        <Group>
          <Path
            path={p((q) => {
              q.moveTo(9, 4);
              q.lineTo(15, 4);
              q.lineTo(13, 7);
              q.quadTo(21, 10, 20, 17);
              q.quadTo(19, 21, 12, 21);
              q.quadTo(5, 21, 4, 17);
              q.quadTo(3, 10, 11, 7);
              q.close();
            })}
            color={color}
          />
          <Rect x={10.5} y={11} width={3} height={7} color={OUT} />
          <Rect x={9} y={12} width={6} height={1.6} color={OUT} />
        </Group>
      );
    case 'loot':
      return (
        <Group>
          <Rect x={11} y={10} width={2.4} height={12} color="#8A6A45" />
          <Path
            path={p((q) => {
              q.moveTo(12, 1.5);
              q.quadTo(18, 6, 15.5, 10.5);
              q.lineTo(8.5, 10.5);
              q.quadTo(6, 6, 12, 1.5);
              q.close();
            })}
            color={color}
          />
        </Group>
      );
    case 'move':
      return (
        <Path
          path={p((q) => {
            q.moveTo(3, 13.5);
            q.lineTo(14, 13.5);
            q.lineTo(14, 18);
            q.lineTo(21, 12);
            q.lineTo(14, 6);
            q.lineTo(14, 10.5);
            q.lineTo(3, 10.5);
            q.close();
          })}
          color={color}
        />
      );
    case 'undo':
      return (
        <Group>
          <Path
            path={p((q) => {
              q.moveTo(8, 7);
              q.lineTo(15, 7);
              q.quadTo(21, 7, 21, 13);
              q.quadTo(21, 19, 15, 19);
              q.lineTo(9, 19);
            })}
            color={color}
            style="stroke"
            strokeWidth={2.6}
            strokeCap="round"
          />
          <Path path={p((q) => { q.moveTo(3, 7); q.lineTo(10, 1.5); q.lineTo(10, 12.5); q.close(); })} color={color} />
        </Group>
      );
    case 'check':
      return (
        <Path
          path={p((q) => {
            q.moveTo(4, 12.5);
            q.lineTo(10, 18.5);
            q.lineTo(20.5, 5.5);
          })}
          color={color}
          style="stroke"
          strokeWidth={3.4}
          strokeCap="round"
          strokeJoin="round"
        />
      );
    case 'menu':
      return (
        <Group>
          <RoundedRect x={4} y={5} width={16} height={2.6} r={1.3} color={color} />
          <RoundedRect x={4} y={11} width={16} height={2.6} r={1.3} color={color} />
          <RoundedRect x={4} y={17} width={16} height={2.6} r={1.3} color={color} />
        </Group>
      );
    case 'log':
      return (
        <Group>
          <RoundedRect x={5} y={3} width={14} height={18} r={2} color={color} style="stroke" strokeWidth={1.8} />
          <Rect x={8} y={8} width={8} height={1.6} color={color} />
          <Rect x={8} y={12} width={8} height={1.6} color={color} />
          <Rect x={8} y={16} width={5} height={1.6} color={color} />
        </Group>
      );
    case 'people':
      return (
        <Group>
          <Circle cx={9} cy={8} r={3.4} color={color} />
          <Path path={p((q) => { q.addArc({ x: 3, y: 12, width: 12, height: 12 }, 180, 180); q.close(); })} color={color} />
          <Circle cx={16.5} cy={9} r={2.8} color={color} opacity={0.75} />
          <Path path={p((q) => { q.addArc({ x: 12, y: 13, width: 10, height: 10 }, 180, 180); q.close(); })} color={color} opacity={0.75} />
        </Group>
      );
    case 'flag':
      return (
        <Group>
          <Rect x={5} y={3} width={2} height={19} color={color} />
          <Path path={p((q) => { q.moveTo(7, 3.5); q.lineTo(20, 7); q.lineTo(7, 12); q.close(); })} color={color} />
        </Group>
      );
    case 'crown':
      return (
        <Path
          path={p((q) => {
            q.moveTo(3, 19);
            q.lineTo(3, 7);
            q.lineTo(8, 12);
            q.lineTo(12, 4);
            q.lineTo(16, 12);
            q.lineTo(21, 7);
            q.lineTo(21, 19);
            q.close();
          })}
          color={color}
        />
      );
    case 'wifi':
      return (
        <Group>
          {[9, 6, 3].map((r) => (
            <Path key={r} path={p((q) => q.addArc({ x: 12 - r * 1.7, y: 19 - r * 1.7, width: r * 3.4, height: r * 3.4 }, 225, 90))} color={color} style="stroke" strokeWidth={2.2} strokeCap="round" />
          ))}
          <Circle cx={12} cy={19} r={1.8} color={color} />
        </Group>
      );
    case 'close':
      return (
        <Path
          path={p((q) => {
            q.moveTo(5, 5);
            q.lineTo(19, 19);
            q.moveTo(19, 5);
            q.lineTo(5, 19);
          })}
          color={color}
          style="stroke"
          strokeWidth={3}
          strokeCap="round"
        />
      );
    case 'city':
      // Тот же город, что на карте.
      return <City x={12} y={19.5} s={0.62} size="large" images={NO_IMAGES} />;
    case 'army':
      // Отряд в цвете игрока (color), как на карте.
      return (
        <Group transform={[{ translateX: -2.4 }, { translateY: -5.2 }, { scale: 0.31 }]}>
          <SoldierGroup color={color} fight={false} />
        </Group>
      );
    case 'sound':
      // Динамик с волнами.
      return (
        <Group>
          <Path path={p((q) => { q.moveTo(3, 9); q.lineTo(7, 9); q.lineTo(12, 4.5); q.lineTo(12, 19.5); q.lineTo(7, 15); q.lineTo(3, 15); q.close(); })} color={color} />
          <Path path={p((q) => q.addArc({ x: 9, y: 7.5, width: 8, height: 9 }, -55, 110))} color={color} style="stroke" strokeWidth={1.8} strokeCap="round" />
          <Path path={p((q) => q.addArc({ x: 8, y: 3.5, width: 13, height: 17 }, -55, 110))} color={color} style="stroke" strokeWidth={1.8} strokeCap="round" />
        </Group>
      );
    case 'music':
      // Две ноты под ребром.
      return (
        <Group>
          <Path path={p((q) => { q.moveTo(9, 17); q.lineTo(9, 5.5); q.lineTo(20, 3); q.lineTo(20, 15); })} color={color} style="stroke" strokeWidth={2} strokeJoin="round" />
          <Path path={p((q) => { q.moveTo(9, 5.5); q.lineTo(20, 3); q.lineTo(20, 6.5); q.lineTo(9, 9); q.close(); })} color={color} />
          <Circle cx={6.5} cy={17.5} r={3} color={color} />
          <Circle cx={17.5} cy={15.5} r={3} color={color} />
        </Group>
      );
    case 'vibration':
      // Телефон с дрожью по бокам.
      return (
        <Group>
          <RoundedRect x={8} y={3} width={8} height={18} r={1.8} color={color} style="stroke" strokeWidth={1.8} />
          <Rect x={10.5} y={17.5} width={3} height={1.2} color={color} />
          <Path path={p((q) => { q.moveTo(4.5, 8); q.lineTo(3, 10); q.lineTo(4.5, 12); q.lineTo(3, 14); q.lineTo(4.5, 16); })} color={color} style="stroke" strokeWidth={1.5} strokeCap="round" strokeJoin="round" />
          <Path path={p((q) => { q.moveTo(19.5, 8); q.lineTo(21, 10); q.lineTo(19.5, 12); q.lineTo(21, 14); q.lineTo(19.5, 16); })} color={color} style="stroke" strokeWidth={1.5} strokeCap="round" strokeJoin="round" />
        </Group>
      );
    case 'swords':
      return (
        <Group>
          <Path path={p((q) => { q.moveTo(4, 4); q.lineTo(18, 18); q.moveTo(20, 4); q.lineTo(6, 18); })} color={color} style="stroke" strokeWidth={2.4} strokeCap="round" />
          <Path path={p((q) => { q.moveTo(15, 21); q.lineTo(21, 15); q.moveTo(3, 15); q.lineTo(9, 21); })} color={color} style="stroke" strokeWidth={2.4} strokeCap="round" />
        </Group>
      );
  }
}

// В браузере каждый Canvas — отдельный WebGL-контекст (их не больше 16), поэтому там иконки
// рисуются один раз в картинку и показываются обычным Image.
const webIcons = new Map<string, Promise<string | null>>();
const ICON_PX = 72;

function webIcon(name: IconName, color: string): Promise<string | null> {
  const key = `${name}:${color}`;
  let p = webIcons.get(key);
  if (!p) {
    p = renderImage(
      <Group transform={[{ scale: ICON_PX / 24 }]}>
        <Glyph name={name} color={color} />
      </Group>,
      { width: ICON_PX, height: ICON_PX },
    )
      .then((img) => (img ? `data:image/png;base64,${img.encodeToBase64()}` : null))
      .catch(() => null);
    webIcons.set(key, p);
  }
  return p;
}

function WebIcon({ name, size, color }: { name: IconName; size: number; color: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    webIcon(name, color).then((u) => alive && setUri(u));
    return () => {
      alive = false;
    };
  }, [name, color]);
  return uri ? <RNImage source={{ uri }} style={{ width: size, height: size }} /> : <RNImage style={{ width: size, height: size }} />;
}

export function Icon({ name, size = 20, color = COLORS.text }: { name: IconName; size?: number; color?: string }) {
  const png = UI[`icon_${name}`];
  if (png) return <RNImage source={png} style={{ width: size, height: size }} resizeMode="contain" />;
  if (Platform.OS === 'web') return <WebIcon name={name} size={size} color={color} />;
  const k = size / 24;
  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ scale: k }]}>
        <Glyph name={name} color={color} />
      </Group>
    </Canvas>
  );
}
