import type { ReactElement } from 'react';
import { Platform } from 'react-native';
import { drawAsImage, drawAsPicture, Skia, type SkImage, type SkSize } from '@shopify/react-native-skia';

/**
 * Рисует элемент в картинку. На телефоне — на видеокарте (drawAsImage). В браузере — на процессоре:
 * там каждый drawAsImage заводит свой WebGL-контекст, их не больше 16, и после этого гаснет сама карта.
 */
export async function renderImage(element: ReactElement, size: SkSize): Promise<SkImage | null> {
  if (Platform.OS !== 'web') return drawAsImage(element, size);
  const w = Math.ceil(size.width);
  const h = Math.ceil(size.height);
  const picture = await drawAsPicture(element, Skia.XYWHRect(0, 0, w, h));
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return null;
  surface.getCanvas().drawPicture(picture);
  surface.flush();
  return surface.makeImageSnapshot();
}
