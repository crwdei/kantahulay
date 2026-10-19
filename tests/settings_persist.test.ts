import { setupTestEnvironment } from './testDbAdapter';
import { SettingsDao } from '../src/db/settingsDao';
import { getDatabaseAsync } from '../src/db/database';
import { PlaybackController } from '../src/engine/PlaybackController';
import { AudioModuleInterface } from '../modules/kantahulay-audio';
import { LibraryModuleInterface } from '../modules/kantahulay-library';

describe('B08 & B17: Audio Settings Persistence & Initialization', () => {
  let mockAudio: jest.Mocked<AudioModuleInterface>;
  let mockLibrary: jest.Mocked<LibraryModuleInterface>;

  beforeEach(async () => {
    setupTestEnvironment();
    const db = await getDatabaseAsync();
    await db.execAsync(`
      DELETE FROM app_state;
      INSERT INTO app_state (id, selected_language, onboarding_completed, bluetooth_lyric_offset_ms, vocal_effects_level)
      VALUES (1, 'en', 1, 0, 1);
    `);

    mockAudio = {
      initialize: jest.fn().mockReturnValue(true),
      loadSoundFont: jest.fn().mockReturnValue(true),
      ensureSoundFontLoaded: jest.fn().mockResolvedValue(true),
      prepareSong: jest.fn().mockResolvedValue(true),
      play: jest.fn(),
      pause: jest.fn(),
      stop: jest.fn(),
      setKeyOffset: jest.fn(),
      getPlaybackState: jest.fn().mockReturnValue(0),
      getCurrentTimeMs: jest.fn().mockReturnValue(0),
      getTotalTimeMs: jest.fn().mockReturnValue(0),
      getLyrics: jest.fn().mockResolvedValue([]),
      isSongEnded: jest.fn().mockReturnValue(false),
      reset: jest.fn(),
      setEffectsLevel: jest.fn(),
      getEffectsLevel: jest.fn().mockReturnValue(1),
      setMasterGain: jest.fn(),
      getMasterGain: jest.fn().mockReturnValue(1.0),
      setBluetoothLyricOffset: jest.fn(),
      setBluetoothLyricOffsetMs: jest.fn(),
      getBluetoothLyricOffset: jest.fn().mockReturnValue(0),
      isBluetoothActive: jest.fn().mockReturnValue(false),
      addAudioFocusListener: jest.fn(),
      addAudioBecomingNoisyListener: jest.fn(),
      setKeepScreenOn: jest.fn(),
    };

    mockLibrary = {
      openPackFd: jest.fn().mockReturnValue(null),
      closePackFd: jest.fn().mockReturnValue(true),
      readManifest: jest.fn().mockReturnValue(JSON.stringify({
        pack_format_version: 1,
        catalog_version: 1,
        pack_sha256: 'mock',
        catalog_sha256: 'mock',
        entry_count: 0,
        pack_bytes: 0,
      })),
      extractCatalogToCache: jest.fn().mockResolvedValue(null),
      copyCatalogToTemp: jest.fn().mockResolvedValue(true),
    };
  });

  test('B08 & B17: SettingsDao saves and retrieves bluetooth offset and vocal effects level', async () => {
    await SettingsDao.setBluetoothLyricOffset(125);
    const offset = await SettingsDao.getBluetoothLyricOffset();
    expect(offset).toBe(125);

    await SettingsDao.setVocalEffectsLevel(2);
    const level = await SettingsDao.getVocalEffectsLevel();
    expect(level).toBe(2);

    // Clamps to all four native/UI presets (0-3)
    await SettingsDao.setVocalEffectsLevel(5);
    expect(await SettingsDao.getVocalEffectsLevel()).toBe(3);

    await SettingsDao.setVocalEffectsLevel(-3);
    expect(await SettingsDao.getVocalEffectsLevel()).toBe(0);

    // U08: Music volume persistence and clamp
    await SettingsDao.setMusicVolume(0.75);
    expect(await SettingsDao.getMusicVolume()).toBe(0.75);

    await SettingsDao.setMusicVolume(1.5);
    expect(await SettingsDao.getMusicVolume()).toBe(1.0);

    await SettingsDao.setMusicVolume(-0.2);
    expect(await SettingsDao.getMusicVolume()).toBe(0.0);
  });

  test('U05: app stays in English by default and language persistence retains en', async () => {
    const lang = await SettingsDao.getLanguage();
    expect(lang).toBe('en');

    // i18n functions still exist and work
    const { t } = require('../src/i18n');
    expect(t('app_name', 'en')).toBe('Kantahulay');
    expect(t('close', 'en')).toBe('Close');
    expect(t('close', 'fil')).toBe('Isara');
    expect(t('close', 'ceb')).toBe('Sirad-i');
  });

  test('B08 & B17: initializeAsync sends persisted settings to native audio before songs play', async () => {
    await SettingsDao.setBluetoothLyricOffset(80);
    await SettingsDao.setVocalEffectsLevel(2);
    await SettingsDao.setMusicVolume(0.85);

    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.initializeAsync();

    expect(mockAudio.setBluetoothLyricOffset).toHaveBeenCalledWith(80);
    expect(mockAudio.setEffectsLevel).toHaveBeenCalledWith(2);
    expect(mockAudio.setMasterGain).toHaveBeenCalledWith(0.85);
  });

  test('U08: controller setMasterGain persists volume to database', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.setMasterGain(0.65);
    expect(mockAudio.setMasterGain).toHaveBeenCalledWith(0.65);
    expect(await SettingsDao.getMusicVolume()).toBe(0.65);
  });

  test('B17: controller setEffectsLevel persists level to database', async () => {
    const controller = new PlaybackController(mockAudio, mockLibrary);
    await controller.initializeAsync();

    await controller.setEffectsLevel(0);
    expect(mockAudio.setEffectsLevel).toHaveBeenCalledWith(0);
    expect(await SettingsDao.getVocalEffectsLevel()).toBe(0);

    await controller.setEffectsLevel(2);
    expect(mockAudio.setEffectsLevel).toHaveBeenCalledWith(2);
    expect(await SettingsDao.getVocalEffectsLevel()).toBe(2);
    await controller.setEffectsLevel(3);
    expect(await SettingsDao.getVocalEffectsLevel()).toBe(3);
    const restarted = new PlaybackController(mockAudio, mockLibrary);
    await restarted.initializeAsync();
    expect(mockAudio.setEffectsLevel).toHaveBeenLastCalledWith(3);
  });

  test('B17: failed settings writes reject instead of reporting success', async () => {
    const db = await getDatabaseAsync();
    await db.execAsync("CREATE TRIGGER fail_effects BEFORE UPDATE OF vocal_effects_level ON app_state BEGIN SELECT RAISE(ABORT, 'injected settings failure'); END;");
    await expect(SettingsDao.setVocalEffectsLevel(3)).rejects.toThrow('injected settings failure');
  });
});
