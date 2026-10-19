# Kantahulay — Offline Karaoke Mobile App

## Approved device baseline

- Android 10+ (minimum SDK 29).
- At least 4 GB physical RAM; virtual/extended RAM does not count toward this baseline.
- ARM64 Android with `arm64-v8a` app support. First release does not target 32-bit Android.
- Free internal storage requirement will be measured using the final signed APK, including installation/update headroom; no fixed size promised yet.

This is an approved engineering target, not verified compatibility with every Android 10+ phone. CPU performance, available memory, storage and audio output still require testing. The chosen RN/Expo/native dependency versions must retain Android 10 support; do not silently raise the minimum OS.

## Budget-phone defaults

- Load one song at a time from the bundled archive; no whole-library RAM load or next-song prefetch for the initial build.
- Use a compact, redistribution-cleared SoundFont. Preallocate and cap synth voices; choose the bank and voice limit through listening and device measurements.
- Query SQLite in pages and virtualize the song list; do not load the complete catalog into JavaScript.
- Use a static stage background by default. Video scenery remains optional and requires separate performance validation on the baseline phone.

## Device verification before claiming support

- Select a physical 4 GB RAM phone with ARM64 Android; record model, chipset, OS version and available storage. No test model selected yet.
- Verify signed APK installation, first launch, exact-code lookup, search, lyrics and key changes on the baseline phone. Include Android 10 coverage before claiming the OS floor is tested.
- Run continuous multi-song playback while browsing and reserving; record session duration, peak memory, audio underruns and any crashes. Test optional scenery separately.
- Verify Bluetooth/output changes, background/lock pause, crash recovery and same-signature APK updates without queue/settings loss.

Status: planning only. No APK built or phone compatibility verified. Full plan updated to v3.1 in `docs/kantahulay-offline-karaoke-v3-bundled.md`; this baseline agrees with it. HTML prototype remains unchanged.
