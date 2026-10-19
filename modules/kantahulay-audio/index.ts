import { requireNativeModule, EventEmitter, type EventSubscription } from 'expo-modules-core';

export interface LyricSyllable {
  text: string;
  timeMs: number;
  isLineBreak: boolean;
  isParagraphBreak: boolean;
}

export interface AudioFocusEvent {
  event: string;
  action: string;
}

export interface AudioBecomingNoisyEvent {
  action: string;
}

export interface AudioModuleInterface {
  initialize(): boolean;
  loadSoundFont(path: string): boolean;
  ensureSoundFontLoaded(): Promise<boolean>;
  beginPreparation?(generation: number): void;
  prepareSong(
    fd: number,
    assetStartOffset: number,
    assetLen: number,
    packOffset: number,
    packedSize: number,
    unpackedSize: number,
    expectedSha256: string,
    reservationId: number,
    generation: number
  ): Promise<boolean>;
  play(): void;
  pause(): void;
  stop(): void;
  setKeyOffset(semitones: number): void;
  getPlaybackState(): number;
  getCurrentTimeMs(): number;
  getTotalTimeMs(): number;
  getLyrics(): Promise<LyricSyllable[]>;
  isSongEnded(): boolean;
  reset(): void;
  setKeepScreenOn?(keepOn: boolean): void;
  addAudioFocusListener?(listener: (event: AudioFocusEvent) => void): EventSubscription;
  addAudioBecomingNoisyListener?(listener: (event: AudioBecomingNoisyEvent) => void): EventSubscription;
  setEffectsLevel?(level: number): void;
  getEffectsLevel?(): number;
  setMasterGain?(gain: number): void;
  getMasterGain?(): number;
  setBluetoothLyricOffset?(offsetMs: number): void;
  setBluetoothLyricOffsetMs?(offsetMs: number): void;
  getBluetoothLyricOffset?(): number;
  isBluetoothActive?(): boolean;
}

interface RawNativeAudioModule {
  initialize(): boolean;
  loadSoundFont(path: string): boolean;
  ensureSoundFontLoaded(): Promise<boolean>;
  beginPreparation(generation: number): void;
  prepareSong(params: Record<string, any>): Promise<boolean>;
  play(): void;
  pause(): void;
  stop(): void;
  setKeyOffset(semitones: number): void;
  getPlaybackState(): number;
  getCurrentTimeMs(): number;
  getTotalTimeMs(): number;
  getLyricsJson(): string;
  isSongEnded(): boolean;
  reset(): void;
  setKeepScreenOn?(keepOn: boolean): void;
  setEffectsLevel(level: number): void;
  getEffectsLevel(): number;
  setMasterGain(gain: number): void;
  getMasterGain(): number;
  setBluetoothLyricOffset(offsetMs: number): void;
  getBluetoothLyricOffset(): number;
  isBluetoothActive(): boolean;
}

let rawModule: RawNativeAudioModule | null = null;
let emitter: { addListener(eventName: string, listener: (...args: any[]) => void): EventSubscription } | null = null;
try {
  rawModule = requireNativeModule<RawNativeAudioModule>('KantahulayAudio');
  if (rawModule) {
    emitter = new (EventEmitter as any)(rawModule);
  }
} catch {
  rawModule = null;
  emitter = null;
}

const AudioModule: AudioModuleInterface = {
  initialize: () => rawModule?.initialize() ?? false,
  loadSoundFont: (path: string) => rawModule?.loadSoundFont(path) ?? false,
  ensureSoundFontLoaded: async () => rawModule?.ensureSoundFontLoaded() ?? false,
  beginPreparation: (generation: number) => rawModule?.beginPreparation(generation),
  prepareSong: async (
    fd: number,
    assetStartOffset: number,
    assetLen: number,
    packOffset: number,
    packedSize: number,
    unpackedSize: number,
    expectedSha256: string,
    reservationId: number,
    generation: number
  ) => {
    if (!rawModule) return false;
    return rawModule.prepareSong({
      fd,
      assetStartOffset,
      assetLen,
      packOffset,
      packedSize,
      unpackedSize,
      expectedSha256,
      reservationId,
      generation,
    });
  },
  play: () => rawModule?.play(),
  pause: () => rawModule?.pause(),
  stop: () => rawModule?.stop(),
  setKeyOffset: (semitones: number) => rawModule?.setKeyOffset(semitones),
  getPlaybackState: () => rawModule?.getPlaybackState() ?? 0,
  getCurrentTimeMs: () => rawModule?.getCurrentTimeMs() ?? 0,
  getTotalTimeMs: () => rawModule?.getTotalTimeMs() ?? 0,
  getLyrics: async () => {
    const json = rawModule?.getLyricsJson();
    if (!json) return [];
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  },
  isSongEnded: () => rawModule?.isSongEnded() ?? false,
  reset: () => rawModule?.reset(),
  setKeepScreenOn: (keepOn: boolean) => rawModule?.setKeepScreenOn?.(keepOn),
  addAudioFocusListener: (listener: (event: AudioFocusEvent) => void) => {
    return emitter?.addListener('onAudioFocusChanged', listener) ?? { remove: () => {} };
  },
  addAudioBecomingNoisyListener: (listener: (event: AudioBecomingNoisyEvent) => void) => {
    return emitter?.addListener('onAudioBecomingNoisy', listener) ?? { remove: () => {} };
  },
  setEffectsLevel: (level: number) => rawModule?.setEffectsLevel(level),
  getEffectsLevel: () => rawModule?.getEffectsLevel() ?? 2,
  setMasterGain: (gain: number) => rawModule?.setMasterGain(gain),
  getMasterGain: () => rawModule?.getMasterGain() ?? 1.0,
  setBluetoothLyricOffset: (offsetMs: number) => rawModule?.setBluetoothLyricOffset(offsetMs),
  setBluetoothLyricOffsetMs: (offsetMs: number) => rawModule?.setBluetoothLyricOffset(offsetMs),
  getBluetoothLyricOffset: () => rawModule?.getBluetoothLyricOffset() ?? 0,
  isBluetoothActive: () => rawModule?.isBluetoothActive() ?? false,
};

export default AudioModule;
