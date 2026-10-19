import {
  ConfigPlugin,
  withAppBuildGradle,
  withDangerousMod,
  withAndroidManifest,
  withGradleProperties,
} from '@expo/config-plugins';
import * as fs from 'fs';
import * as path from 'path';

export const withBundledKantahulayAssets: ConfigPlugin = (config) => {
  // 1. Strip unwanted permissions (INTERNET, storage, alert window) to guarantee offline-only
  config = withAndroidManifest(config, (manifestConfig) => {
    const manifest = manifestConfig.modResults;
    if (manifest.manifest['uses-permission']) {
      const blocked = [
        'android.permission.INTERNET',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
      ];
      manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'].filter(
        (perm: any) => !blocked.includes(perm.$?.['android:name'])
      );
    }
    return manifestConfig;
  });

  // 2. Configure app/build.gradle: signing, abiFilters, noCompress
  config = withAppBuildGradle(config, (gradleConfig) => {
    let contents = gradleConfig.modResults.contents;

    // Configure noCompress for kpak and sf2
    if (!contents.includes("noCompress 'kpak'")) {
      const aaptBlock = `
android {
    androidResources {
        noCompress 'kpak', 'sf2'
    }
}
`;
      contents += '\n' + aaptBlock;
    }

    // Configure release signing from keystore.properties or environment variables
    if (!contents.includes('keystore.properties')) {
      const signingSnippet = `
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            def keystorePropsFile = rootProject.file("keystore.properties").exists() ?
                rootProject.file("keystore.properties") :
                file("\${rootDir}/../keystore.properties")

            if (keystorePropsFile.exists()) {
                def props = new Properties()
                props.load(new FileInputStream(keystorePropsFile))
                storeFile = props['storeFile'] ? file(props['storeFile']) : null
                storePassword = props['storePassword']
                keyAlias = props['keyAlias']
                keyPassword = props['keyPassword']
            } else if (System.getenv("KEYSTORE_PATH")) {
                storeFile = file(System.getenv("KEYSTORE_PATH"))
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS")
                keyPassword = System.getenv("KEY_PASSWORD")
            } else {
                println "\\n********************************************************************************\\nWARNING: RELEASE BUILD SIGNED WITH DEBUG KEY - NOT FOR DISTRIBUTION\\n********************************************************************************\\n"
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
    }`;

      contents = contents.replace(
        /signingConfigs\s*\{[\s\S]*?debug\s*\{[\s\S]*?\}\s*\}/,
        signingSnippet.trim()
      );

      // In buildTypes release, use signingConfigs.release and set abiFilters
      const btRegex = /buildTypes\s*\{\s*debug\s*\{[\s\S]*?signingConfig\s+signingConfigs\.debug[\s\S]*?\}\s*release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.debug/;
      contents = contents.replace(btRegex, (match) => {
        const target = 'signingConfig signingConfigs.debug';
        const lastIndex = match.lastIndexOf(target);
        if (lastIndex === -1) return match;
        return (
          match.slice(0, lastIndex) +
          'signingConfig signingConfigs.release\n            ndk {\n                abiFilters "arm64-v8a", "armeabi-v7a"\n            }' +
          match.slice(lastIndex + target.length)
        );
      });
      if (!contents.includes('abiFilters "arm64-v8a", "armeabi-v7a"')) {
        contents = contents.replace(
          /targetSdkVersion\s+rootProject\.ext\.targetSdkVersion/,
          'targetSdkVersion rootProject.ext.targetSdkVersion\n        ndk {\n            abiFilters "arm64-v8a", "armeabi-v7a"\n        }'
        );
      }
    }

    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });

  // 3. Restrict architectures in gradle.properties to arm64-v8a and armeabi-v7a
  config = withGradleProperties(config, (gradlePropsConfig) => {
    gradlePropsConfig.modResults = gradlePropsConfig.modResults.filter(
      (item) => item.type !== 'property' || item.key !== 'reactNativeArchitectures'
    );
    gradlePropsConfig.modResults.push({
      type: 'property',
      key: 'reactNativeArchitectures',
      value: 'arm64-v8a,armeabi-v7a',
    });
    return gradlePropsConfig;
  });

  // 3. Copy bundled library files to android/app/src/main/assets
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const projectRoot = modConfig.modRequest.projectRoot;
      const buildDir = path.join(projectRoot, 'build', 'bundled-library');
      const sampleDir = path.join(projectRoot, 'sample-pack');
      const srcDir = fs.existsSync(buildDir) ? buildDir : sampleDir;
      const targetDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'assets'
      );

      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        const files = fs.readdirSync(srcDir);
        for (const file of files) {
          if (
            file.endsWith('.kpak') ||
            file.endsWith('.sqlite') ||
            file.endsWith('.json') ||
            file.endsWith('.sf2')
          ) {
            const srcFile = path.join(srcDir, file);
            const destFile = path.join(targetDir, file);
            fs.copyFileSync(srcFile, destFile);
          }
        }
      }

      // Ensure android/local.properties has sdk.dir
      const localPropPath = path.join(projectRoot, 'android', 'local.properties');
      if (!fs.existsSync(localPropPath)) {
        const homeDir = process.env.USERPROFILE || process.env.HOME || '';
        const defaultSdk = path.join(homeDir, 'AppData', 'Local', 'Android', 'Sdk');
        if (fs.existsSync(defaultSdk)) {
          const formatted = defaultSdk.replace(/\\/g, '/');
          fs.writeFileSync(localPropPath, `sdk.dir=${formatted}\n`);
        }
      }
      return modConfig;
    },
  ]);

  return config;
};

export default withBundledKantahulayAssets;
