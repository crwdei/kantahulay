#!/usr/bin/env bash
# Build FluidSynth v2.6.1 shared libraries for Android using NDK
# Linkage: DYNAMIC shared object (.so) under LGPL-2.1

set -euo pipefail

FLUIDSYNTH_VERSION="2.6.1"
NDK_PATH="${ANDROID_NDK_HOME:-$LOCALAPPDATA/Android/Sdk/ndk/27.1.12297006}"
CMAKE_BIN="${CMAKE_BIN:-$LOCALAPPDATA/Android/Sdk/cmake/3.22.1/bin/cmake.exe}"
NINJA_BIN="${NINJA_BIN:-$LOCALAPPDATA/Android/Sdk/cmake/3.22.1/bin/ninja.exe}"

SRC_DIR="WORKSPACE/fluidsynth-src"

for ABI in "arm64-v8a" "armeabi-v7a"; do
  BUILD_DIR="WORKSPACE/fluidsynth-build-${ABI}"
  OUT_DIR="modules/kantahulay-audio/android/src/main/jniLibs/${ABI}"
  mkdir -p "$BUILD_DIR" "$OUT_DIR"

  "$CMAKE_BIN" -GNinja \
    -DCMAKE_MAKE_PROGRAM="$NINJA_BIN" \
    -DCMAKE_TOOLCHAIN_FILE="$NDK_PATH/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$ABI" \
    -DANDROID_PLATFORM=android-24 \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=ON \
    -Dosal=cpp11 \
    -Denable-libinstpatch=0 \
    -Denable-aufile=OFF \
    -Denable-dbus=OFF \
    -Denable-ipv6=OFF \
    -Denable-jack=OFF \
    -Denable-ladspa=OFF \
    -Denable-libsndfile=OFF \
    -Denable-midishare=OFF \
    -Denable-opensles=OFF \
    -Denable-oboe=OFF \
    -Denable-network=OFF \
    -Denable-oss=OFF \
    -Denable-dsound=OFF \
    -Denable-wasapi=OFF \
    -Denable-waveout=OFF \
    -Denable-winmidi=OFF \
    -Denable-sdl3=OFF \
    -Denable-pulseaudio=OFF \
    -Denable-pipewire=OFF \
    -Denable-readline=OFF \
    -Denable-threads=ON \
    -Denable-openmp=OFF \
    -Denable-native-dls=OFF \
    -DBUILD_UNIT_TESTS=OFF \
    -DBUILD_PROGRAMS=OFF \
    -DCMAKE_SHARED_LINKER_FLAGS="-Wl,-z,max-page-size=16384" \
    -B "$BUILD_DIR" \
    -S "$SRC_DIR"

  "$NINJA_BIN" -C "$BUILD_DIR" libfluidsynth
  cp "$BUILD_DIR/src/libfluidsynth.so" "$OUT_DIR/libfluidsynth.so"
  echo "Built $ABI -> $OUT_DIR/libfluidsynth.so"
done
