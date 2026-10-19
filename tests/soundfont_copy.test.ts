import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('B04: SoundFont atomic copy and corrupt file recovery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // Emulates the atomic copy algorithm implemented in KantahulayAudioModule.kt
  function ensureSoundFont(
    filesDir: string,
    assetContent: Buffer,
    expectedSize: number
  ): { success: boolean; finalSize: number; didCopy: boolean } {
    const versionedName = 'soundfont-gugs-v2.sf2';
    const sfFile = path.join(filesDir, versionedName);
    const tmpFile = path.join(filesDir, `${versionedName}.tmp`);
    const oldFile = path.join(filesDir, 'soundfont.sf2');

    if (fs.existsSync(oldFile)) {
      fs.unlinkSync(oldFile);
    }

    const needsCopy = !fs.existsSync(sfFile) ||
      (expectedSize > 0 && fs.statSync(sfFile).size !== expectedSize) ||
      (expectedSize <= 0 && fs.statSync(sfFile).size < 1_000_000);

    if (!needsCopy) {
      return { success: true, finalSize: fs.statSync(sfFile).size, didCopy: false };
    }

    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }

    // Write to .tmp file
    fs.writeFileSync(tmpFile, assetContent);
    const bytesWritten = fs.statSync(tmpFile).size;

    if (expectedSize > 0 && bytesWritten !== expectedSize) {
      fs.unlinkSync(tmpFile);
      return { success: false, finalSize: 0, didCopy: true };
    }

    if (bytesWritten < 1_000_000) {
      fs.unlinkSync(tmpFile);
      return { success: false, finalSize: 0, didCopy: true };
    }

    // Atomic rename
    if (fs.existsSync(sfFile)) {
      fs.unlinkSync(sfFile);
    }
    fs.renameSync(tmpFile, sfFile);

    return { success: true, finalSize: fs.statSync(sfFile).size, didCopy: true };
  }

  test('verifies real packaged soundfont asset matches expected 32,319,396 bytes when present', () => {
    const realAssetPath = path.resolve(__dirname, '../android/app/src/main/assets/soundfont-gugs-v2.sf2');
    if (!fs.existsSync(realAssetPath)) {
      return;
    }
    const stat = fs.statSync(realAssetPath);
    expect(stat.size).toBe(32_319_396);

    const fd = fs.openSync(realAssetPath, 'r');
    const headerBuf = Buffer.alloc(12);
    fs.readSync(fd, headerBuf, 0, 12, 0);
    fs.closeSync(fd);
    expect(headerBuf.toString('ascii', 0, 4)).toBe('RIFF');
    expect(headerBuf.toString('ascii', 8, 12)).toBe('sfbk');
  });

  test('re-copies when file does not exist', () => {
    const fakeAsset = Buffer.alloc(1_500_000, 0x55);
    const res = ensureSoundFont(tempDir, fakeAsset, 1_500_000);
    expect(res.success).toBe(true);
    expect(res.didCopy).toBe(true);
    expect(res.finalSize).toBe(1_500_000);
  });

  test('re-copies when existing file is 0 bytes or truncated', () => {
    const sfFile = path.join(tempDir, 'soundfont-gugs-v2.sf2');
    fs.writeFileSync(sfFile, Buffer.alloc(0)); // 0-byte corrupt file

    const fakeAsset = Buffer.alloc(2_000_000, 0xaa);
    const res = ensureSoundFont(tempDir, fakeAsset, 2_000_000);
    expect(res.success).toBe(true);
    expect(res.didCopy).toBe(true);
    expect(res.finalSize).toBe(2_000_000);
  });

  test('re-copies when existing file has wrong size (e.g. 500KB instead of 2MB)', () => {
    const sfFile = path.join(tempDir, 'soundfont-gugs-v2.sf2');
    fs.writeFileSync(sfFile, Buffer.alloc(500_000, 0x11)); // partial write

    const fakeAsset = Buffer.alloc(2_000_000, 0xaa);
    const res = ensureSoundFont(tempDir, fakeAsset, 2_000_000);
    expect(res.success).toBe(true);
    expect(res.didCopy).toBe(true);
    expect(res.finalSize).toBe(2_000_000);
  });

  test('skips copy when existing file has exact matching size', () => {
    const sfFile = path.join(tempDir, 'soundfont-gugs-v2.sf2');
    fs.writeFileSync(sfFile, Buffer.alloc(2_000_000, 0xaa));

    const fakeAsset = Buffer.alloc(2_000_000, 0xaa);
    const res = ensureSoundFont(tempDir, fakeAsset, 2_000_000);
    expect(res.success).toBe(true);
    expect(res.didCopy).toBe(false);
    expect(res.finalSize).toBe(2_000_000);
  });

  test('B04: PlaybackController awaits soundfont load before prepareSong runs', async () => {
    const { setupTestEnvironment, cleanupTestEnvironment } = require('./testDbAdapter');
    const { PlaybackController } = require('../src/engine/PlaybackController');
    const { getDatabaseAsync } = require('../src/db/database');

    setupTestEnvironment();
    const db = await getDatabaseAsync();
    await db.runAsync(
      `INSERT INTO songs (code, title, artist, search_key, duration_ticks, has_singable_lyrics, pack_offset, packed_size, unpacked_size, midi_sha256)
       VALUES ('000001', 'Test Song', 'Test Artist', 'test', 1000, 1, 16, 100, 200, 'hash');`
    );

    let soundFontLoaded = false;
    let preparedAfterSoundFont = false;
    let sfResolve: (val: boolean) => void;
    const sfPromise = new Promise<boolean>((resolve) => {
      sfResolve = resolve;
    });

    const mockAudio: any = {
      initialize: jest.fn().mockReturnValue(true),
      ensureSoundFontLoaded: jest.fn().mockImplementation(() => sfPromise),
      loadSoundFont: jest.fn().mockReturnValue(true),
      beginPreparation: jest.fn(),
      prepareSong: jest.fn().mockImplementation(async () => {
        preparedAfterSoundFont = soundFontLoaded;
        return true;
      }),
      play: jest.fn(),
      pause: jest.fn(),
      stop: jest.fn(),
      reset: jest.fn(),
      setKeyOffset: jest.fn(),
      getPlaybackState: jest.fn().mockReturnValue(0),
      getCurrentTimeMs: jest.fn().mockReturnValue(0),
      getTotalTimeMs: jest.fn().mockReturnValue(60000),
      getLyrics: jest.fn().mockResolvedValue([]),
      isSongEnded: jest.fn().mockReturnValue(false),
    };

    const mockLibrary: any = {
      openPackFd: jest.fn().mockReturnValue({ fd: 10, startOffset: 0, length: 1000 }),
      readManifest: jest.fn().mockReturnValue(null),
      extractCatalogToCache: jest.fn().mockResolvedValue(null),
    };

    const controller = new PlaybackController(mockAudio, mockLibrary);
    const initPromise = controller.initializeAsync();

    // Call reserve while SoundFont copy/load is still in flight
    const reservePromise = controller.reserve('000001');

    // Give microtasks time to run
    await new Promise((r) => setTimeout(r, 20));
    expect(mockAudio.prepareSong).not.toHaveBeenCalled();

    // SoundFont finishes loading
    soundFontLoaded = true;
    sfResolve!(true);

    await Promise.all([initPromise, reservePromise]);

    expect(mockAudio.prepareSong).toHaveBeenCalled();
    expect(preparedAfterSoundFont).toBe(true);
    expect(controller.getState()).toBe('PLAYING');

    cleanupTestEnvironment();
  });
});
