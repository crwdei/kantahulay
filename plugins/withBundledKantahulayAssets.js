"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.withBundledKantahulayAssets = void 0;
const config_plugins_1 = require("@expo/config-plugins");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));

const withBundledKantahulayAssets = (config) => {
    // 1. Strip unwanted permissions (INTERNET, storage, alert window) to guarantee offline-only
    config = (0, config_plugins_1.withAndroidManifest)(config, (manifestConfig) => {
        const manifest = manifestConfig.modResults;
        if (manifest.manifest['uses-permission']) {
            const blocked = [
                'android.permission.INTERNET',
                'android.permission.READ_EXTERNAL_STORAGE',
                'android.permission.WRITE_EXTERNAL_STORAGE',
                'android.permission.SYSTEM_ALERT_WINDOW',
            ];
            manifest.manifest['uses-permission'] = manifest.manifest['uses-permission'].filter(
                (perm) => !blocked.includes(perm.$?.['android:name'])
            );
        }
        return manifestConfig;
    });

    // 2. Configure app/build.gradle: signing, abiFilters, noCompress
    config = (0, config_plugins_1.withAppBuildGradle)(config, (gradleConfig) => {
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
    config = (0, config_plugins_1.withGradleProperties)(config, (gradlePropsConfig) => {
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
    config = (0, config_plugins_1.withDangerousMod)(config, [
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

exports.withBundledKantahulayAssets = withBundledKantahulayAssets;
exports.default = exports.withBundledKantahulayAssets;
