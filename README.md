# Kantahulay (Kantahang Mahusay)

> Offline-first videoke / karaoke player for Android, designed for low-friction home gatherings, road trips, and parties with zero internet connection required.

[![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Android-green.svg)](https://developer.android.com)
[![Expo SDK](https://img.shields.io/badge/expo-SDK%2054-black.svg)](https://expo.dev)

Repository: [https://github.com/crwdei/kantahulay](https://github.com/crwdei/kantahulay)

---

## Screenshots

<!-- Add screenshots here -->
<p align="center">
  <img src="assets/kantahulay_logo_transparent.png" alt="Kantahulay Logo" width="220" />
</p>
<p align="center">
  <em>(Screenshots coming soon)</em>
</p>

---

## Overview & Architecture

Kantahulay is built to run entirely offline on budget and high-end Android devices alike.

* **Audio Synthesis:** Real-time software MIDI synthesis using **FluidSynth v2.6.1** (LGPL-2.1 dynamic library).
* **Low-Latency Audio Output:** High-performance Android AAudio / OpenSL ES playback via **Google Oboe v1.9.0**.
* **Frontend:** **React Native 0.81** with **Expo SDK 54** and Continuous Native Generation (CNG).
* **Database & Songbook:** Fast offline song search, queue management, and playback history using **SQLite** (`expo-sqlite`).
* **Karaoke Mechanics:**
  * Leap-frog lyric sweeper with synchronized timeline animation.
  * 4-dot musical intro / interlude countdown meter.
  * Live pitch / key transpose (-6 to +6 semitones).
  * Auto-reorienting landscape and portrait player layout.
  * Works fully offline, zero tracking, zero telemetry (standard framework network permissions are completely unused).

---

## Song Content & SoundFont Disclaimer

* **No commercial songs included:** This repository does **NOT** distribute copyrighted music or commercial MIDI/KAR libraries. Users must provide their own legal song files.
* **Sample Pack:** A 5-song sample pack built exclusively from public-domain traditional Philippine folk songs (*Bahay Kubo*, *Leron Leron Sinta*, *Sitsiritsit*, *Paru-parong Bukid*, *Magtanim Ay Di Biro*) is included in `sample-pack/` so the app can be compiled, run, and tested immediately.
* **SoundFont:** SoundFont sound banks (such as GeneralUser GS) are not included in the repository due to redistribution restrictions. See below for installation instructions.

---

## Prerequisites

1. **Node.js:** v18 or later (v20+ recommended)
2. **Java Development Kit (JDK):** JDK 17 (recommended for React Native 0.81 / Android Gradle Plugin 8)
3. **Android SDK & NDK:**
   * Android SDK Platform 35
   * Android NDK 27.x
   * CMake 3.22.1+
4. **Python:** Python 3.9+ (for song pack generator script)

---

## How to Build

### 1. Install Dependencies

```bash
npm install
```

### 2. Download SoundFont (Required for Audio)

FluidSynth requires a SoundFont bank (`.sf2`) to synthesize MIDI audio. Download GeneralUser GS:

```bash
python scripts/download_soundfont.py
# Or if you already have an SF2 file:
python scripts/download_soundfont.py --file /path/to/GeneralUser_GS.sf2
```

> **Note:** If no SoundFont is bundled, the app launches but displays a clear startup error card (*"Could not initialize audio engine"*) instead of playing silently.

### 3. Generate Native Android Project

Kantahulay uses Expo prebuild to generate clean Android project files:

```bash
npx expo prebuild --platform android --no-install
```

### 4. Configure Release Signing (Optional)

By default, release builds automatically fall back to Android's debug keystore for friction-free local testing.

For official production builds, copy the example signing configuration:

```bash
cp keystore.properties.example keystore.properties
```

Edit `keystore.properties` with your keystore path, alias, and passwords. Alternatively, export them as environment variables:

```bash
export KEYSTORE_PATH="/path/to/release.keystore"
export KEYSTORE_PASSWORD="your_store_password"
export KEY_ALIAS="your_key_alias"
export KEY_PASSWORD="your_key_password"
```

### 5. Build Release APK

```bash
cd android
./gradlew :app:assembleRelease
```

The compiled APK will be located at:
`android/app/build/outputs/apk/release/app-release.apk`

---

## How to Make a Song Pack

Kantahulay bundles song files into a binary `.kpak` archive and SQLite catalog for fast random access and low memory footprint on budget phones.

1. Prepare a folder of `.mid` and `.kar` files. Standard filename convention:
   ```
   <song_number> - <Song Title> - <Artist Name>.mid
   ```
   Example: `000001 - Anak - Freddie Aguilar.mid`

2. Run the packaging tool:
   ```bash
   python scripts/pack_library.py --input /path/to/my_songs --output build/bundled-library
   ```

   This produces:
   * `songs.kpak`: Compressed song archive with 16-byte index headers.
   * `catalog.sqlite`: Pre-indexed search database.
   * `bundle_manifest.json`: Verification manifest with SHA-256 digests.

3. Rebuild the app with `npx expo prebuild --platform android` to bundle your new library into the APK.

---

## Running Tests & Verification

```bash
# Run unit and integration tests
npm test

# Type-check TypeScript sources
npm run typecheck

# Lint codebase
npm run lint
```

---

## License & Third-Party Notices

* Kantahulay application code is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.
* Third-party libraries (FluidSynth, Oboe, React Native, Expo, etc.) are subject to their respective licenses. See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
* FluidSynth is dynamically linked as a separate shared object (`libfluidsynth.so`) under the GNU Lesser General Public License v2.1 (LGPL-2.1).
