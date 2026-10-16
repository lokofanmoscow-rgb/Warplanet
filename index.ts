import { Platform } from 'react-native';
import { registerRootComponent } from 'expo';

// В браузере (для разработки) Skia работает через CanvasKit — его нужно загрузить до приложения.
if (Platform.OS === 'web') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LoadSkiaWeb } = require('@shopify/react-native-skia/lib/module/web');
  LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    registerRootComponent(require('./src/ui/App').default);
  });
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  registerRootComponent(require('./src/ui/App').default);
}
