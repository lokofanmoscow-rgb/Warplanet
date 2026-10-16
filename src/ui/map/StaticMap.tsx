import React, { useEffect, useState } from 'react';
import { drawAsImage, Group, Image, Path, type SkFont, type SkImage } from '@shopify/react-native-skia';
import type { GameState } from '../../engine';
import type { MapGeometry } from './geometry';
import { CityLayer, DecorLayer, fillColor, LabelLayer, LandLayer } from './layers';
import type { SpriteImages } from './sprites';

// Статичная часть карты (суша, границы, декор, города, подписи) рисуется не в каждом кадре,
// а один раз в картинку: целиком для обзора и отдельно — видимая область в разрешении экрана при приближении.
// В кадре остаются только картинки, анимированная вода, выделение, плашки и стрелки.

/** Разрешение общей картинки: пикселей на единицу карты. */
export const BASE_RES = 1.5;

export interface DetailRequest {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Пикселей на единицу карты. */
  ps: number;
  /** Масштаб подписей; null — без подписей. */
  labelK: number | null;
}

interface StaticProps {
  geo: MapGeometry;
  game: GameState;
  own: string;
  forts: string;
  images: SpriteImages;
  noise: SkImage | null;
}

function StaticContent({ labels, ...p }: StaticProps & { labels?: { font: SkFont; k: number } | null }) {
  return (
    <Group>
      <LandLayer geo={p.geo} game={p.game} ownershipKey={p.own} noise={p.noise} />
      <DecorLayer geo={p.geo} images={p.images} />
      <CityLayer geo={p.geo} game={p.game} fortKey={p.forts} images={p.images} />
      {labels ? <LabelLayer geo={p.geo} font={labels.font} k={labels.k} /> : null}
    </Group>
  );
}

/** Пока картинка не готова — только заливки провинций (быстро). */
function QuickLand({ geo, game }: { geo: MapGeometry; game: GameState }) {
  return (
    <Group>
      {geo.map.cells.map((c, i) =>
        c.kind === 'land' ? <Path key={c.id} path={geo.cellPaths[i]} color={fillColor(game.cells[i].owner, game)} /> : null,
      )}
    </Group>
  );
}

export const StaticMap = React.memo(function StaticMap({
  detail,
  labelFont,
  ...p
}: StaticProps & { detail: DetailRequest | null; labelFont: SkFont | null }) {
  const { geo } = p;
  const W = geo.map.width;
  const H = geo.map.height;
  const [base, setBase] = useState<SkImage | null>(null);
  const [baseFailed, setBaseFailed] = useState(false);
  const [detailImg, setDetailImg] = useState<{ img: SkImage; req: DetailRequest } | null>(null);
  const imagesKey = Object.values(p.images).filter(Boolean).length;
  const key = `${geo.map.id}|${p.own}|${p.forts}|${p.noise ? 1 : 0}|${imagesKey}`;

  useEffect(() => {
    let alive = true;
    drawAsImage(
      <Group transform={[{ scale: BASE_RES }]}>
        <StaticContent {...p} />
      </Group>,
      { width: Math.round(W * BASE_RES), height: Math.round(H * BASE_RES) },
    )
      .then((img) => {
        if (!alive) return;
        if (img) setBase(img);
        else setBaseFailed(true);
      })
      .catch(() => alive && setBaseFailed(true));
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!detail || baseFailed) {
      setDetailImg(null);
      return;
    }
    let alive = true;
    const labels = detail.labelK !== null && labelFont ? { font: labelFont, k: detail.labelK } : null;
    drawAsImage(
      <Group transform={[{ scale: detail.ps }, { translateX: -detail.x0 }, { translateY: -detail.y0 }]}>
        <StaticContent {...p} labels={labels} />
      </Group>,
      { width: Math.ceil(detail.w * detail.ps), height: Math.ceil(detail.h * detail.ps) },
    )
      .then((img) => {
        if (alive && img) setDetailImg({ img, req: detail });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [detail, key, labelFont, baseFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  // Офскрин недоступен — рисуем вживую (медленнее, но работает).
  if (baseFailed) {
    return <StaticContent {...p} labels={detail?.labelK != null && labelFont ? { font: labelFont, k: detail.labelK } : null} />;
  }
  return (
    <Group>
      {base ? <Image image={base} x={0} y={0} width={W} height={H} /> : <QuickLand geo={geo} game={p.game} />}
      {detailImg && (
        <Image image={detailImg.img} x={detailImg.req.x0} y={detailImg.req.y0} width={detailImg.req.w} height={detailImg.req.h} />
      )}
    </Group>
  );
});
