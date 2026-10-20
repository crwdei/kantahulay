import { ExpoConfig, ConfigContext } from 'expo/config';
import withBundledKantahulayAssets from './plugins/withBundledKantahulayAssets';

export default ({ config }: ConfigContext): ExpoConfig => {
  const baseConfig: ExpoConfig = {
    ...config,
    name: 'Kantahulay',
    slug: 'kantahulay',
    version: '1.0.1',
    orientation: 'default',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    splash: {
      image: './assets/kantahulay_logo_transparent.png',
      resizeMode: 'contain',
      backgroundColor: '#0B0D12',
    },
    android: {
      package: 'com.kantahulay.app',
      versionCode: 4,
      adaptiveIcon: {
        backgroundColor: '#0B0D12',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
    },
    plugins: [
      'expo-dev-client',
    ],
  };

  return withBundledKantahulayAssets(baseConfig) as ExpoConfig;
};
